import { alcadaDoEnvelope } from './alcada.const'
import { entregaPublica } from '../hub/hub-work-item.service'
import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import { ApprovalService } from '../execution/approval.service'
import { ExecutionService, papelDaAcao } from '../execution/execution.service'
import {
  ConteudoDoHandoff, EfeitoDoHandoff, EstadoDoHandoff,
  chaveDeIdempotencia, ehFinal, hashDoConteudo, podeTransicionar, refDeBaseValida,
} from './handoff.const'
import {
  ResultadoDaPrevia, VeredictoDaPrevia, VerificacaoDoEfeito, avaliarPrevia, verificarEfeito,
  EntregaDoHandoff, ResultadoDaPreviaDaSessao, avaliarPreviaDaSessao, verificarEntregaDaSessao,
  nadaFoiPublicado,
} from './handoff-preflight'

/** Efeito cuja entrega é um branch (item 7.2a) — prévia, verificação e sessão próprias. */
export const EFEITO_SESSAO = 'jarvis:supervised_session'

/**
 * Quem vai CONSUMIR a aprovação — o mesmo papel para onde `ExecutionService` manda a tarefa.
 *
 * O alvo assinado inclui o ator, e o agent confere com o próprio papel. Até 16/11 isto era
 * `'desktop'` fixo: no primeiro envelope de sessão roteado para a sandbox do servidor, o
 * agent-server consumiu como `server`, o hash não bateu e a execução foi recusada (certo).
 * Uma regra só para os dois lados: rotear para um lugar e assinar para outro é o defeito.
 */
export function atorDoEfeito(actionKey: string, env: NodeJS.ProcessEnv = process.env): string {
  return papelDaAcao(actionKey.replace(/^jarvis:/, ''), env) ?? 'desktop'
}

/**
 * Os únicos efeitos que um envelope sabe materializar: os que têm prévia (`dryRun`) com
 * veredicto escrito — `avaliarPrevia` para criar projeto, `avaliarPreviaDaSessao` para sessão.
 *
 * Qualquer outro, despachado com `dryRun: true`, cairia numa ação que pode não conhecer o
 * `dryRun` e EXECUTAR na prévia (um `open_url` abriria a URL), e depois falharia o veredicto
 * por não ter a forma esperada. Recusar antes de despachar é a única saída que não executa às
 * cegas. Medido ao ligar a alçada autônoma (S1, 15/11): nenhum efeito autônomo está aqui, então
 * a alçada autônoma de envelope fica pronta e sem caminho até um efeito novo ganhar prévia.
 */
export const EFEITOS_MATERIALIZAVEIS: readonly string[] = ['jarvis:create_project_folder', EFEITO_SESSAO]

/** Item 7.3 — como a sessão supervisionada é aprovada; ver `payloadDaSessao`. */
export const MODOS_DE_APROVACAO = ['por_entrega', 'por_etapa'] as const
export type ModoDeAprovacao = (typeof MODOS_DE_APROVACAO)[number]

/** Prévia (teto de 30 s) + claim do poller (3 s) com sobra — ver `exigirAprovacaoVigente`. */
export const FOLGA_DA_APROVACAO_MS = 60_000
import { alvoDaExecucao } from '../execution/alvo-de-execucao.const'
import { VALIDADE_PADRAO_MS, hashDoAlvo } from '../execution/approval.service'
import { isolamentoDoEfeito } from './isolamento-por-efeito.const'

/**
 * Ciclo de vida do `ProjectHandoff`.
 *
 * Ele não reimplementa nada do que já existe: a autorização continua sendo um
 * `ExecutionApproval` (alvo canonicalizado, validade, consumo único) e a execução continua
 * passando pelo broker da Fase 1 (chave de idempotência, lease, fencing). O que o envelope
 * acrescenta é a **ligação durável** entre os dois, e a ordem em que eles acontecem.
 */
@Injectable()
export class HandoffService {
  private readonly logger = new Logger(HandoffService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly approvals: ApprovalService,
    private readonly execution: ExecutionService,
  ) {}

  async criar(dto: ConteudoDoHandoff, principal: string) {
    this.validarConteudo(dto)
    const sourceProjectId = dto.sourceProjectId?.trim() || null
    if (sourceProjectId) {
      const sourceProject = await (this.prisma as any).project.findUnique({ where: { id: sourceProjectId }, select: { id: true } })
      if (!sourceProject) throw new NotFoundException(`Projeto de origem ${sourceProjectId} não encontrado`)
    }
    // A sessão é cunhada ANTES do hash: o `sessionId` entra no conteúdo aprovado, e é ele que
    // dá nome ao branch (`rayzen/sessao-<id>`). Cunhado depois, a aprovação assinaria uma carga
    // e o agent consumiria outra.
    const { dto: comSessao, sessionId } = await this.comSessaoCunhada(dto)
    const conteudo = this.comIsolamentoDerivado(comSessao)
    try {
      return await this.criarLinha(conteudo, sourceProjectId, principal)
    } catch (e) {
      // Sessão sem envelope não roda nunca; deixá-la `pending` seria uma linha que promete
      // trabalho. Marca o desfecho em vez de apagar: o registro de que existiu fica.
      if (sessionId) {
        await this.prisma.agentSession.update({
          where: { id: sessionId },
          data: { status: 'error', summary: 'O envelope que deveria executar esta sessão não foi criado.' },
        }).catch(() => null)
      }
      throw e
    }
  }

  private async criarLinha(conteudo: ConteudoDoHandoff, sourceProjectId: string | null, principal: string) {
    const linha = await this.prisma.projectHandoff.create({
      data: {
        sourceProjectId,
        name: conteudo.name,
        brief: conteudo.brief,
        template: conteudo.template,
        root: conteudo.root,
        effects: conteudo.efeitos as unknown as object,
        isolamento: conteudo.isolamento as string,
        contentHash: hashDoConteudo(conteudo),
        status: 'draft',
        createdBy: principal,
      },
    })
    if (sourceProjectId && nasceuNoHub(principal)) await this.vincularAoFioDoProjeto(linha.id, sourceProjectId)
    return linha
  }

  /**
   * G2.11 (24/11): o envelope que nasceu do próprio Hub — da conversa do fio, de uma rotina do
   * projeto ou de uma continuação tocada no Hub — entra no fio do projeto sozinho. Antes o vínculo
   * era sempre manual e a entrega completa só aparecia depois de alguém tocar "vincular".
   *
   * O fio é de uma PESSOA (`principalId` do login), e quem cria o envelope é um serviço; por isso o
   * fio é achado pelo projeto: exatamente um fio ativo de pessoa → vincula. Nenhum, ou mais de um
   * (duas pessoas no mesmo projeto), não se adivinha: o envelope fica em "Sem vínculo", como antes.
   * Nunca lança: falhar aqui não pode desfazer a criação do envelope.
   */
  private async vincularAoFioDoProjeto(handoffId: string, projectId: string): Promise<void> {
    try {
      const db = this.prisma as unknown as {
        hubThread: { findMany(a: unknown): Promise<Array<{ id: string }>> }
        hubWorkItem: { upsert(a: unknown): Promise<unknown> }
      }
      const fios = await db.hubThread.findMany({
        where: { projectId, scopeType: 'project', status: 'active', NOT: { principalId: { startsWith: 'service:' } } },
        select: { id: true }, take: 2,
      })
      if (fios.length !== 1) return
      const chave = { threadId: fios[0].id, sourceSystem: 'v1', sourceId: handoffId }
      await db.hubWorkItem.upsert({
        where: { threadId_sourceSystem_sourceId: chave },
        create: { ...chave, kind: 'project_handoff' },
        update: {},
      })
    } catch (e) {
      this.logger.warn(`handoff ${handoffId.slice(0, 8)}: vínculo automático ao fio falhou: ${(e as Error).message}`)
    }
  }

  /**
   * Editar um rascunho **sobe a versão** e reescreve o hash.
   *
   * Autorização se refere a um conteúdo, não a um id — então um envelope editado depois de
   * aprovado perde o aceite por construção, e não pela disciplina de alguém lembrar de limpar
   * o campo. É a mesma razão pela qual `hashDoAlvo()` põe os argumentos dentro da assinatura.
   */
  async editar(id: string, dto: ConteudoDoHandoff, principal: string) {
    this.validarConteudo(dto)
    const atual = await this.buscar(id)
    if (atual.status !== 'draft' && atual.status !== 'awaiting_approval') {
      throw new ConflictException(`Handoff em ${atual.status} não aceita edição`)
    }

    const conteudo = this.comIsolamentoDerivado(await this.comSessaoPreservada(atual, dto))
    const hash = hashDoConteudo(conteudo)
    // Reenviar o mesmo conteúdo não é uma revisão: subir versão aqui invalidaria um aceite por
    // causa de um PUT repetido, que é o falso negativo que faz alguém parar de usar o fluxo.
    if (hash === atual.contentHash && atual.status === 'draft') return atual

    return this.prisma.projectHandoff.update({
      where: { id },
      data: {
        name: conteudo.name,
        brief: conteudo.brief,
        template: conteudo.template,
        root: conteudo.root,
        effects: conteudo.efeitos as unknown as object,
        isolamento: conteudo.isolamento as string,
        contentHash: hash,
        version: atual.version + 1,
        status: 'draft',
        approvalId: null,
        approvedBy: null,
        approvedAt: null,
        motivo: atual.status === 'awaiting_approval'
          ? `editado por ${principal} — aceite anterior invalidado`
          : null,
      },
    })
  }

  /**
   * Enviar é onde a alçada autônoma acontece (S1, 15/11). Efeito `autonomo` não espera ninguém:
   * a política aprova — com `createdByType: 'policy'`, para o Hub poder responder "o que fiz
   * sozinho" — e materializa. O envelope passa por `awaiting_approval` mesmo assim, para que o
   * caminho e o registro sejam os mesmos dos outros níveis; o que muda é só quem aprova.
   *
   * Falhar ao materializar deixa o envelope `approved`, dito no retorno, como na porta do Hub.
   */
  async submeter(id: string) {
    const enviado = await this.transicionar(id, 'awaiting_approval')
    const efeitos = this.efeitosDe(enviado.effects)
    const alcada = alcadaDoEnvelope(efeitos)
    if (efeitos[0]?.actionKey === EFEITO_SESSAO) await this.gravarPreviaDoEnvio(enviado, efeitos[0])
    if (alcada !== 'autonomo') return { ...enviado, alcada }

    await this.aprovar(id, { id: 'alcada:autonomo', type: 'policy' })
    try {
      const resultado = await this.materializar(id)
      this.logger.log(`envelope ${id} aprovado e materializado pela alçada autônoma`)
      return { ...(await this.buscar(id)), alcada, materializado: true, resultado }
    } catch (e) {
      return { ...(await this.buscar(id)), alcada, materializado: false, motivo: (e as Error).message }
    }
  }

  /**
   * S1c (15/11): o Hub responde com o link — PR, branch, commit — em vez de descrever a entrega.
   * Só entrega CONFIRMADA (gravada do postflight medido) e pela mesma projeção do cartão:
   * remoto fora (pode carregar credencial) e link só se for PR do GitHub.
   */
  /**
   * G2.9 (24/11): o que está rodando agora. Antes o "trabalhos" listava proposta, parado e
   * entrega — e o envelope em execução sumia da tela justo enquanto trabalhava. Cada linha traz a
   * etapa (última linha do log ao vivo), se há pergunta esperando e o link do VS Code da pasta.
   */
  private async emAndamento(escopo: { sourceProjectId?: string }) {
    const linhas = await this.prisma.projectHandoff.findMany({
      where: { ...escopo, status: { in: [...ESTADOS_EM_ANDAMENTO] } },
      orderBy: { updatedAt: 'desc' }, take: 10,
    })
    const sessaoPorHandoff = new Map<string, string>()
    for (const h of linhas) {
      const efeito = this.efeitosDe(h.effects).find((e) => e.actionKey === EFEITO_SESSAO)
      const sessionId = efeito?.payload?.sessionId
      if (typeof sessionId === 'string') sessaoPorHandoff.set(h.id, sessionId)
    }
    const ids = [...new Set(sessaoPorHandoff.values())]
    const sessoes = ids.length
      ? await this.prisma.agentSession.findMany({
        where: { id: { in: ids } },
        select: { id: true, status: true, liveLog: true, pendingQuestion: true, vscodeUrl: true },
      })
      : []
    const porId = new Map(sessoes.map((s) => [s.id, s]))
    return linhas.map((h) => {
      const sessionId = sessaoPorHandoff.get(h.id) ?? null
      const s = sessionId ? porId.get(sessionId) : undefined
      return {
        id: h.id, name: h.name, status: h.status, quando: h.updatedAt,
        sessao: sessionId ? {
          id: sessionId,
          status: s?.status ?? null,
          etapa: ultimaLinhaDoLog(s?.liveLog ?? null),
          aguardandoResposta: Boolean(s?.pendingQuestion),
          vscodeUrl: s?.vscodeUrl ?? null,
        } : null,
      }
    })
  }

  private async entregasRecentes(escopo: { sourceProjectId?: string }, desde: Date) {
    const linhas = await this.prisma.projectHandoff.findMany({
      where: { ...escopo, status: 'completed', updatedAt: { gte: desde } },
      orderBy: { updatedAt: 'desc' }, take: 10,
    })
    const sessaoPorHandoff = new Map<string, string>()
    for (const h of linhas) {
      const efeito = this.efeitosDe((h as { effects?: unknown }).effects)
        .find((e) => e.actionKey === EFEITO_SESSAO)
      const sessionId = efeito?.payload?.sessionId
      if (typeof sessionId === 'string') sessaoPorHandoff.set(h.id, sessionId)
    }
    const sessionIds = [...new Set(sessaoPorHandoff.values())]
    const sessoes = sessionIds.length
      ? await this.prisma.agentSession.findMany({
        where: { id: { in: sessionIds } },
        select: { id: true, papel: true, provedor: true, modelo: true, costUsd: true, numTurns: true, testVerification: true },
      })
      : []
    const sessaoPorId = new Map(sessoes.map((s) => [s.id, s]))

    return linhas
      .map((h) => {
        const sessionId = sessaoPorHandoff.get(h.id)
        const sessao = sessionId ? sessaoPorId.get(sessionId) : undefined
        return {
          handoffId: h.id,
          name: h.name,
          entrega: entregaPublica((h as { delivery?: unknown }).delivery),
          // G2.10 (24/11): quem aprovou e o que o Rayzen testou, para o cartão dizer a entrega
          // inteira — estavam gravados e não chegavam à tela.
          aprovadoPor: h.approvedBy ?? null,
          verificacao: resumoDaVerificacao(sessao?.testVerification ?? null),
          sessao: sessionId ? {
            papel: sessao?.papel ?? null,
            provedor: sessao?.provedor ?? null,
            modelo: sessao?.modelo ?? null,
            costUsd: sessao?.costUsd ?? null,
            numTurns: sessao?.numTurns ?? null,
          } : null,
        }
      })
      .filter((x) => x.entrega !== null)
  }

  /**
   * S1d (15/11): a pergunta da sessão aparece no fio do Hub, não só no Telegram e no
   * `/work-panel`. A sessão vem do envelope (o `sessionId` é cunhado pelo servidor e mora no
   * payload), então a pergunta fica presa ao projeto do fio — nunca uma lista global de sessões.
   */
  private async perguntasDasSessoes(escopo: { sourceProjectId?: string }) {
    const emCurso = await this.prisma.projectHandoff.findMany({
      where: { ...escopo, status: { in: ['queued', 'claimed', 'executing'] } },
      orderBy: { updatedAt: 'desc' }, take: 20,
    })
    const porSessao = new Map<string, { handoffId: string; name: string }>()
    for (const h of emCurso) {
      const efeito = this.efeitosDe(h.effects)[0]
      const sessionId = efeito?.actionKey === EFEITO_SESSAO ? efeito.payload?.sessionId : undefined
      if (typeof sessionId === 'string') porSessao.set(sessionId, { handoffId: h.id, name: h.name })
    }
    if (porSessao.size === 0) return []
    const sessoes = await this.prisma.agentSession.findMany({
      where: { id: { in: [...porSessao.keys()] }, status: 'waiting' },
    })
    return sessoes.filter((s) => s.pendingQuestion).map((s) => ({
      sessionId: s.id,
      ...porSessao.get(s.id)!,
      pergunta: s.pendingQuestion as string,
      exigeAprovacao: s.pendingRequiresApproval,
      opcoes: Array.isArray(s.pendingApprovalOptions) ? (s.pendingApprovalOptions as string[]) : null,
      // HC6 (23/11): a prévia ao vivo é para ver ANTES de decidir, e o link só existia no
      // `/work-panel` e no meio do texto da pergunta. Só https vira link clicável no fio.
      previa: typeof s.previewUrl === 'string' && /^https:\/\/[^\s]+$/i.test(s.previewUrl) ? s.previewUrl : null,
      desde: s.updatedAt,
    }))
  }

  /**
   * S1f: a prévia da sessão roda também no ENVIO, para o card avisar "sem remoto, sem PR" antes
   * do toque. É a mesma prévia do `materializar` (sem estado, só mede) e não decide nada: falhar
   * aqui só grava o erro, e o card diz que não conferiu. O `materializar` roda a dele de novo.
   */
  private async gravarPreviaDoEnvio(
    handoff: { id: string; root: string; contentHash: string; name?: string },
    efeito: EfeitoDoHandoff,
  ) {
    let previa: unknown
    try {
      previa = await this.execution.dispatch('supervised_session', { ...this.cargaDoEfeito(handoff, efeito), dryRun: true })
    } catch (e) {
      previa = { error: (e instanceof Error ? e.message : String(e)).slice(0, 300) }
    }
    await this.prisma.projectHandoff.update({ where: { id: handoff.id }, data: { preflight: (previa ?? {}) as object } })
      .catch((e: Error) => this.logger.warn(`prévia do envio de ${handoff.id} não gravou: ${e.message}`))
  }

  /**
   * Descartar pelo Hub (S1e, 15/11) — antes só saía por SQL (`ed46a303`, `8df5fb1a`).
   *
   * `effect_unknown` vai para `failed_safe`, e o motivo diz que foi uma pessoa conferindo: o
   * estado não é final justamente porque a saída dele é reconciliação humana. `approved` e
   * `queued` (aceite que não vai mais rodar) vão para `cancelled`. Nada mais se descarta aqui:
   * o que está rodando tem dono, e o que aguarda aprovação se rejeita.
   */
  async descartar(id: string, principal: { id: string }) {
    const handoff = await this.buscar(id)
    const de = handoff.status
    const para: EstadoDoHandoff | null = de === 'effect_unknown'
      ? 'failed_safe'
      : (de === 'approved' || de === 'queued') ? 'cancelled' : null
    if (!para) throw new ConflictException(`Envelope em ${de} não se descarta por aqui`)
    const motivo = de === 'effect_unknown'
      ? `descartado por ${principal.id} — efeito incerto conferido à mão`
      : `descartado por ${principal.id} — aceite que não vai mais rodar`
    return this.transicionar(id, para, motivo)
  }

  /**
   * G3.2 (24/11): retomar, com um toque, a sessão que o executor largou no meio
   * (docs/decisions/G3.2-retomada-desenho.md).
   *
   * O envelope incerto não reabre — `effect_unknown` só sai por reconciliação. Nasce um envelope
   * de CONTINUAÇÃO, com o mesmo pedido e `retomaDe` = a sessão antiga, e o toque da pessoa é a
   * aprovação dele (a alçada de sessão é de um toque, e o alvo é o mesmo que ela já tinha
   * aprovado). `retomaDe` entra DEPOIS de o conteúdo passar pela validação normal: nenhum
   * produtor de envelope consegue pedi-lo, só este caminho.
   *
   * Quem mede se dá para retomar é a prévia do envelope novo, na sandbox: a pasta existe, o
   * ramo está lá, e nada chegou ao GitHub. Se ela recusar, a continuação é cancelada e o
   * envelope antigo fica como estava — com o motivo, para a pessoa decidir.
   */
  async retomarInterrompida(id: string, principal: { id: string; type: string }) {
    const antigo = await this.buscar(id)
    if (antigo.status !== 'effect_unknown') {
      throw new ConflictException(`Envelope em ${antigo.status}: só se retoma uma sessão que ficou com efeito incerto`)
    }
    const efeitos = this.efeitosDe(antigo.effects)
    const efeito = efeitos[0]
    const sessaoAntiga = efeito?.actionKey === EFEITO_SESSAO ? efeito.payload?.sessionId : undefined
    if (efeitos.length !== 1 || typeof sessaoAntiga !== 'string') {
      throw new ConflictException('Só uma sessão de código se retoma')
    }
    const sessao = await this.prisma.agentSession.findUnique({ where: { id: sessaoAntiga }, select: { status: true } })
    if (sessao?.status !== 'interrupted') {
      throw new ConflictException('A sessão não foi interrompida pelo executor: confira o que aconteceu antes de repetir')
    }

    const dto: ConteudoDoHandoff = {
      ...(antigo.sourceProjectId ? { sourceProjectId: antigo.sourceProjectId } : {}),
      name: antigo.name,
      brief: antigo.brief,
      template: antigo.template,
      root: antigo.root,
      efeitos: [{ actionKey: EFEITO_SESSAO, payload: this.payloadDaSessao(efeito.payload) }],
    }
    this.validarConteudo(dto)
    const { dto: comSessao } = await this.comSessaoCunhada(dto)
    const [cunhado] = comSessao.efeitos
    const continuacao: ConteudoDoHandoff = {
      ...comSessao,
      efeitos: [{ ...cunhado, payload: { ...cunhado.payload, retomaDe: sessaoAntiga } }],
    }
    const novo = await this.criarLinha(this.comIsolamentoDerivado(continuacao), antigo.sourceProjectId, principal.id)
    await this.transicionar(novo.id, 'awaiting_approval')
    await this.aprovar(novo.id, principal)
    try {
      await this.materializar(novo.id)
    } catch (e) {
      const motivo = (e as Error).message
      await this.transicionar(novo.id, 'cancelled', `continuação não rodou: ${motivo}`)
      return { retomado: false, motivo, novoId: novo.id }
    }
    await this.transicionar(id, 'failed_safe', `sessão interrompida; continuada no envelope ${novo.id.slice(0, 8)} por ${principal.id}`)
    this.logger.log(`envelope ${id.slice(0, 8)} retomado como ${novo.id.slice(0, 8)} (sessão ${sessaoAntiga.slice(0, 8)})`)
    return { retomado: true, novoId: novo.id }
  }

  /** Ids dos envelopes incertos cuja sessão foi marcada `interrupted`. */
  private async sessoesInterrompidas(parados: { id: string; status: string; effects: unknown }[]): Promise<Set<string>> {
    const porSessao = new Map<string, string>()
    for (const h of parados) {
      if (h.status !== 'effect_unknown') continue
      const efeito = this.efeitosDe(h.effects)[0]
      const sessionId = efeito?.actionKey === EFEITO_SESSAO ? efeito.payload?.sessionId : undefined
      if (typeof sessionId === 'string') porSessao.set(sessionId, h.id)
    }
    if (porSessao.size === 0) return new Set()
    const sessoes = await this.prisma.agentSession.findMany({
      where: { id: { in: [...porSessao.keys()] }, status: 'interrupted' }, select: { id: true },
    })
    return new Set(sessoes.map((s) => porSessao.get(s.id)!).filter(Boolean))
  }

  /**
   * As três perguntas do aceite do S1, a partir do registro — nunca da redação do modelo:
   * o que fiz sozinho (aprovado pela alçada autônoma), o que estou propondo (aguardando), e o
   * que parou e precisa de uma pessoa (aceito sem rodar, ou efeito incerto).
   */
  async resumo(projectId?: string, dias = 7) {
    const desde = new Date(Date.now() - dias * 24 * 60 * 60 * 1000)
    const escopo = projectId ? { sourceProjectId: projectId } : {}
    const [sozinho, propondo, parados] = await Promise.all([
      this.prisma.projectHandoff.findMany({
        where: { ...escopo, approvedBy: 'alcada:autonomo', approvedAt: { gte: desde } },
        orderBy: { approvedAt: 'desc' }, take: 20,
      }),
      this.prisma.projectHandoff.findMany({
        where: { ...escopo, status: 'awaiting_approval' }, orderBy: { createdAt: 'desc' }, take: 20,
      }),
      this.prisma.projectHandoff.findMany({
        where: { ...escopo, status: { in: ['approved', 'effect_unknown'] } }, orderBy: { updatedAt: 'desc' }, take: 20,
      }),
    ])
    // G3.2: o cartão incerto só oferece "Retomar" quando a sessão dele foi INTERROMPIDA pelo
    // executor (G3.2a). A medição de que dá mesmo para retomar — pasta, ramo, nada publicado —
    // acontece no toque, na prévia do envelope de continuação.
    const interrompidas = await this.sessoesInterrompidas(parados)
    const linha = (h: { id: string; name: string; status: string; effects: unknown; motivo: string | null; updatedAt: Date }) => {
      const efeitos = this.efeitosDe(h.effects)
      return {
        id: h.id, name: h.name, status: h.status, motivo: h.motivo, quando: h.updatedAt,
        acao: efeitos[0]?.actionKey ?? null, alcada: alcadaDoEnvelope(efeitos),
      }
    }
    return {
      janelaDias: dias,
      fizSozinho: sozinho.map(linha),
      proponho: propondo.map(linha),
      precisaDeVoce: parados.map((h) => ({ ...linha(h), retomavel: interrompidas.has(h.id) })),
      perguntas: await this.perguntasDasSessoes(escopo),
      entregas: await this.entregasRecentes(escopo, desde),
      emAndamento: await this.emAndamento(escopo),
    }
  }

  cancelar(id: string, motivo?: string) {
    return this.transicionar(id, 'cancelled', motivo)
  }

  rejeitar(id: string, motivo?: string) {
    return this.transicionar(id, 'rejected', motivo)
  }

  /**
   * Aprovar emite um `ExecutionApproval` com o alvo exato do efeito.
   *
   * O `argsHash` da aprovação cobre ação, ator, recurso e argumentos — então trocar o payload
   * depois do aceite invalida a autorização sozinho, sem precisar de uma segunda checagem
   * aqui. O envelope guarda o id da aprovação para que a evidência sobreviva ao consumo dela:
   * a aprovação morre ao ser usada, o registro do que foi aprovado não.
   */
  async aprovar(id: string, principal: { id: string; type: string }) {
    const handoff = await this.buscar(id)
    if (handoff.status !== 'awaiting_approval') {
      throw new ConflictException(`Handoff em ${handoff.status} não está aguardando aprovação`)
    }

    const efeitos = this.efeitosDe(handoff.effects)
    if (efeitos.length !== 1) {
      // A validação de escrita já aplica a regra; este ramo cobre envelope gravado antes
      // dela. Uma assinatura sobre dois efeitos não teria resposta para "o hash cobre qual?"
      // — e a resposta da decisão é que cada efeito tem o seu envelope e a sua aprovação.
      throw new BadRequestException(
        `um efeito por envelope — este tem ${efeitos.length}; aprovação em lote emite uma autorização por envelope, nunca uma para várias`,
      )
    }

    // O alvo precisa ser descrito EXATAMENTE como o agent vai descreve-lo ao consumir, senao
    // `hashDoAlvo` nunca casa. A carga aqui e a mesma que `materializar()` vai enfileirar.
    const carga = this.cargaDoEfeito(handoff, efeitos[0])
    const aprovacao = await this.approvals.criar(
      alvoDaExecucao(efeitos[0].actionKey, atorDoEfeito(efeitos[0].actionKey), carga),
      principal,
    )

    return this.prisma.projectHandoff.update({
      where: { id },
      data: {
        status: 'approved',
        approvalId: aprovacao.id,
        approvedBy: principal.id,
        approvedAt: new Date(),
        motivo: null,
      },
    })
  }

  /**
   * Materializar enfileira pelo broker, com chave derivada do handoff **e da versão**.
   *
   * Do handoff, para que reentregar o mesmo envelope devolva replay em vez de criar uma
   * segunda pasta. Da versão, porque um envelope editado é outro pedido: reaproveitar a chave
   * faria o broker devolver o replay da execução anterior e a edição nunca aconteceria — sem
   * erro nenhum, que é a pior forma.
   */
  /**
   * A aprovação vale minutos (`VALIDADE_PADRAO_MS`); o `approved` do envelope não expira.
   *
   * Sem esta checagem, retomar um envelope depois de uma recusa da prévia — o caso que
   * `approved` existe para permitir — enfileirava uma tarefa que o agent recusaria por falta
   * de aprovação válida, e o envelope terminava em `failed_safe` sem ter rodado nada (medido
   * em 15/11: aprovado 02:20, vencido 02:30, retomado 02:55). Aqui ele volta a
   * `awaiting_approval` e reaparece no card pedindo código novo. O conteúdo é o mesmo, então a
   * pessoa aprova o que já tinha lido.
   *
   * A folga cobre a prévia (até 30 s) e o claim do poller: uma aprovação que vence no meio do
   * caminho falharia do mesmo jeito, só que mais tarde.
   */
  private async exigirAprovacaoVigente(handoff: { id: string; approvalId: string | null }) {
    const aprovacao = handoff.approvalId
      ? await this.prisma.executionApproval.findUnique({
        where: { id: handoff.approvalId },
        select: { expiresAt: true, consumedAt: true },
      })
      : null

    const limite = new Date(Date.now() + FOLGA_DA_APROVACAO_MS)
    let motivo: string | null = null
    if (!aprovacao) motivo = 'o envelope não tem aprovação registrada'
    else if (aprovacao.consumedAt) motivo = 'a aprovação já foi usada por outra tentativa'
    else if (aprovacao.expiresAt <= limite) {
      motivo = `a aprovação venceu às ${aprovacao.expiresAt.toISOString().slice(11, 16)} UTC (vale ${VALIDADE_PADRAO_MS / 60_000} min)`
    }
    if (!motivo) return

    await this.prisma.projectHandoff.update({
      where: { id: handoff.id },
      data: {
        status: 'awaiting_approval',
        approvalId: null,
        approvedBy: null,
        approvedAt: null,
        motivo: `${motivo} — aguardando novo código para o mesmo conteúdo`,
      },
    })
    throw new ConflictException(`Aprovação precisa ser renovada: ${motivo}. O envelope voltou a aguardar aprovação, com o mesmo conteúdo.`)
  }

  async materializar(id: string) {
    const handoff = await this.buscar(id)
    if (handoff.status !== 'approved') {
      throw new ConflictException(`Handoff em ${handoff.status} não foi aprovado`)
    }

    const efeitos = this.efeitosDe(handoff.effects)
    if (!efeitos[0] || !EFEITOS_MATERIALIZAVEIS.includes(efeitos[0].actionKey)) {
      throw new ConflictException(
        `o efeito ${efeitos[0]?.actionKey ?? '(nenhum)'} não tem prévia conhecida — envelope só materializa ` +
        `${EFEITOS_MATERIALIZAVEIS.join(' e ')}; nada foi despachado`,
      )
    }

    await this.exigirAprovacaoVigente(handoff)

    const chave = chaveDeIdempotencia(handoff.id, handoff.version)
    // `ExecutionService.enqueue` recebe a ação sem o prefixo — ele monta `jarvis:<ação>`.
    const acao = efeitos[0].actionKey.replace(/^jarvis:/, '')
    const carga = this.cargaDoEfeito(handoff, efeitos[0])

    // ── Reconciliar ANTES de materializar ────────────────────────────────────
    //
    // "Filesystem, catálogo e Git reconciliados antes de abrir o VS Code" é o que a fase pede,
    // e a prévia do `dryRun` já responde isso. Ela roda na máquina que é dona da regra de safe
    // root e onde o disco existe — perguntar a ela é mais barato e mais verdadeiro que manter
    // uma quinta cópia daquela regra aqui.
    //
    // `dispatch` espera o resultado (teto de 30s), e uma prévia é sub-segundo. Se o agent
    // estiver fora, `enqueue` já falha antes disso, pelo heartbeat.
    const ehSessao = efeitos[0].actionKey === EFEITO_SESSAO
    let previa: unknown = null
    let veredicto: VeredictoDaPrevia
    try {
      previa = await this.execution.dispatch(acao, { ...carga, dryRun: true })
      veredicto = ehSessao
        ? avaliarPreviaDaSessao(previa as ResultadoDaPreviaDaSessao, handoff.root)
        : avaliarPrevia(previa as ResultadoDaPrevia, handoff.root)
    } catch (e) {
      const erro = e instanceof Error ? e.message : String(e)
      veredicto = { ok: false, motivo: `a prévia não completou: ${erro}` }
    }

    if (!veredicto.ok) {
      // O envelope FICA em `approved`: a autorização continua válida e a materialização pode
      // ser tentada de novo depois de resolver o que a prévia apontou. Levá-lo a um estado
      // final aqui jogaria fora um aceite por causa de uma condição temporária do disco.
      await this.prisma.projectHandoff.update({
        where: { id },
        data: { preflight: (previa ?? {}) as object, motivo: veredicto.motivo },
      })
      throw new ConflictException(`Reconciliação recusou a materialização: ${veredicto.motivo}`)
    }

    const taskId = await this.execution.enqueue(
      acao,
      carga,
      undefined,
      chave,
    )

    this.logger.log(`handoff ${handoff.id.slice(0, 8)} materializado como tarefa ${taskId}`)
    if (ehSessao && typeof carga.sessionId === 'string') {
      // `pending` → `active` só aqui: a sessão existe desde a criação do envelope, mas só
      // passa a "trabalhando" quando há tarefa na fila para ela.
      await this.prisma.agentSession.update({ where: { id: carga.sessionId }, data: { status: 'active' } })
        .catch((e: unknown) => this.logger.warn(`sessão ${String(carga.sessionId)} não marcada active: ${String(e)}`))
    }
    return this.prisma.projectHandoff.update({
      where: { id },
      data: {
        status: 'queued',
        taskId,
        idempotencyKey: chave,
        preflight: (previa ?? {}) as object,
        motivo: veredicto.motivo,
      },
    })
  }


  /**
   * Fecha o envelope depois da execucao — ou abre incerteza.
   *
   * ── Por que existe um passo entre `done` e `completed` ─────────────────────
   * O executor dizer que terminou e um relato, nao uma prova. Esta casa ja pagou por confundir
   * os dois: em 17/08 os tres servicos apareciam `Up (healthy)` com a producao rodando codigo
   * de nove horas antes. A verificacao pergunta ao disco e ao catalogo se o efeito esta la.
   *
   * ── Tres desfechos ────────────────────────────────────────────────────────
   * Confirmado fecha em `completed`. Ausente vira `effect_unknown`, porque tarefa concluida
   * sem efeito visivel e incerteza que pede uma pessoa, nao falha comum. E nao-verificado NAO
   * MOVE NADA: nao conseguir olhar nao autoriza afirmar nada, e a varredura tenta de novo.
   */
  async reconciliar(id: string) {
    const handoff = await this.buscar(id)
    if (handoff.status !== 'reconciling') {
      throw new ConflictException(`Handoff em ${handoff.status} nao esta em reconciliacao`)
    }

    const efeitos = this.efeitosDe(handoff.effects)
    const carga = this.cargaDoEfeito(handoff, efeitos[0])
    const acao = efeitos[0].actionKey.replace(/^jarvis:/, '')

    // O retrato do git de ANTES vem do preflight gravado. Sem ele a comparação não teria dois
    // lados, e a divergência — que é o registro útil aqui — não existiria.
    const preflight = handoff.preflight as ResultadoDaPrevia | null
    const gitAntes = preflight?.previa?.git

    const ehSessao = efeitos[0].actionKey === EFEITO_SESSAO
    let entrega: EntregaDoHandoff | undefined
    let resultado: unknown = null
    let verificacao: VerificacaoDoEfeito
    try {
      resultado = await this.execution.dispatch(acao, { ...carga, dryRun: true })
      if (ehSessao) {
        // A entrega sai da MEDIÇÃO do postflight (ls-remote, gh pr view), nunca do resumo que
        // a sessão postou ao concluir — relato não é prova.
        const v = verificarEntregaDaSessao(resultado as ResultadoDaPreviaDaSessao, preflight?.path)
        verificacao = { estado: v.estado, motivo: v.motivo } as VerificacaoDoEfeito
        entrega = v.entrega
      } else {
        verificacao = verificarEfeito(resultado as ResultadoDaPrevia, gitAntes, preflight?.path)
      }
    } catch (e) {
      verificacao = {
        estado: 'nao-verificado',
        motivo: `a verificacao nao completou: ${e instanceof Error ? e.message : String(e)}`,
      }
    }

    if (verificacao.estado === 'nao-verificado') {
      // Fica onde esta, de proposito. Gravar o motivo deixa visivel POR QUE nao fechou, sem
      // afirmar nada sobre o efeito.
      await this.prisma.projectHandoff.update({
        where: { id },
        data: { motivo: verificacao.motivo },
      })
      return this.buscar(id)
    }

    // O disco e o catalogo podem estar corretos mesmo que um agent antigo tenha
    // ignorado a aprovacao de um efeito medium. Nao chamar isso de completed:
    // conferir a aprovacao emitida para este envelope, o alvo exato e a tarefa
    // que a consumiu. Falha de leitura nao e evidencia de ausencia.
    let motivoDaAutorizacao: string | null = null
    if (verificacao.estado === 'confirmado') {
      if (!handoff.approvalId || !handoff.taskId || !handoff.approvedBy) {
        motivoDaAutorizacao = 'efeito presente, mas o envelope nao tem aprovacao e tarefa vinculadas'
      } else {
        let aprovacao: {
          argsHash: string; createdBy: string; consumedAt: Date | null; consumedByTask: string | null
        } | null
        try {
          aprovacao = await this.prisma.executionApproval.findUnique({
            where: { id: handoff.approvalId },
            select: { argsHash: true, createdBy: true, consumedAt: true, consumedByTask: true },
          })
        } catch (e) {
          await this.prisma.projectHandoff.update({
            where: { id },
            data: { motivo: `a verificacao da aprovacao nao completou: ${e instanceof Error ? e.message : String(e)}` },
          })
          return this.buscar(id)
        }
        const hashEsperado = hashDoAlvo(alvoDaExecucao(efeitos[0].actionKey, atorDoEfeito(efeitos[0].actionKey), carga))
        if (!aprovacao || aprovacao.argsHash !== hashEsperado
          || aprovacao.createdBy !== handoff.approvedBy
          || !aprovacao.consumedAt || aprovacao.consumedByTask !== handoff.taskId) {
          motivoDaAutorizacao = 'efeito presente, mas a aprovacao do alvo nao foi consumida pela tarefa vinculada'
        }
      }
    }

    let proximo: EstadoDoHandoff = verificacao.estado === 'confirmado' && !motivoDaAutorizacao
      ? 'completed' : 'effect_unknown'
    // 21/11 (aceite do G6): "Não publicar" no portão do diff deixava o envelope `effect_unknown`,
    // e a pessoa precisava descartá-lo à mão — a decisão dela tratada como incerteza. Fecha em
    // `failed_safe` (o mesmo destino do descarte manual) só com as DUAS provas: a recusa gravada
    // pela API na hora da resposta (nunca o relato da sessão) e a medição de que nada saiu.
    let motivoDaRecusa: string | null = null
    if (proximo === 'effect_unknown' && ehSessao && nadaFoiPublicado(resultado as ResultadoDaPreviaDaSessao, preflight?.path)) {
      // Falha de leitura não é prova de recusa: o envelope fica incerto, como antes.
      let recusa: { publicacaoRecusadaEm: Date | null; publicacaoRecusadaPor: string | null } | null = null
      try {
        recusa = typeof carga.sessionId === 'string'
          ? await this.prisma.agentSession.findUnique({
            where: { id: carga.sessionId }, select: { publicacaoRecusadaEm: true, publicacaoRecusadaPor: true },
          })
          : null
      } catch (e) {
        this.logger.warn(`handoff ${handoff.id.slice(0, 8)}: recusa de publicação não lida: ${String(e)}`)
      }
      if (recusa?.publicacaoRecusadaEm) {
        proximo = 'failed_safe'
        motivoDaRecusa = `publicação recusada por ${recusa.publicacaoRecusadaPor ?? 'desconhecido'} no portão do diff ` +
          `(${recusa.publicacaoRecusadaEm.toISOString()}) — nada publicado; o ramo ficou só na sandbox`
      }
    }
    // Só o postflight que confirmou disco E checkout do catálogo pode ligar o
    // envelope ao projeto materializado. O id não vem do payload aprovado nem do
    // relato `done` da tarefa; vem da consulta independente feita pelo agent.
    // Na sessão, o projeto não é materializado: é o do payload aprovado, que o preflight já
    // resolveu para um checkout real.
    const projetoConfirmado = proximo !== 'completed'
      ? undefined
      : ehSessao
        ? (typeof carga.projectId === 'string' ? carga.projectId : undefined)
        : (resultado as ResultadoDaPrevia).previa?.projetoJaRegistrado?.id
    this.logger.log(`handoff ${handoff.id.slice(0, 8)}: verificacao ${verificacao.estado} para ${proximo}`)
    return this.prisma.projectHandoff.update({
      where: { id },
      data: {
        status: proximo,
        ...(projetoConfirmado ? { projectId: projetoConfirmado } : {}),
        ...(proximo === 'completed' && entrega ? { delivery: entrega as unknown as object } : {}),
        postflight: (resultado ?? {}) as object,
        motivo: motivoDaRecusa ?? motivoDaAutorizacao ?? verificacao.motivo,
      },
    })
  }

  /** Envelopes parados em reconciliacao, dos mais antigos primeiro. */
  emReconciliacao(maisVelhosQueMs: number) {
    return this.prisma.projectHandoff.findMany({
      where: { status: 'reconciling', updatedAt: { lt: new Date(Date.now() - maisVelhosQueMs) } },
      orderBy: { updatedAt: 'asc' },
      select: { id: true },
      take: 20,
    })
  }

  listar(status?: EstadoDoHandoff) {
    return this.prisma.projectHandoff.findMany({
      where: status ? { status } : {},
      orderBy: { createdAt: 'desc' },
      take: 100,
    })
  }

  async buscar(id: string) {
    const handoff = await this.prisma.projectHandoff.findUnique({ where: { id } })
    if (!handoff) throw new NotFoundException('Handoff não encontrado')
    return handoff
  }

  /** Toda mudança de estado passa por aqui — a máquina é uma só. */
  private async transicionar(id: string, para: EstadoDoHandoff, motivo?: string) {
    const handoff = await this.buscar(id)
    const de = handoff.status as EstadoDoHandoff

    if (ehFinal(de)) throw new ConflictException(`Handoff já está em ${de}, que é estado final`)
    if (!podeTransicionar(de, para)) {
      throw new ConflictException(`Transição ${de} para ${para} não é permitida`)
    }

    return this.prisma.projectHandoff.update({
      where: { id },
      data: { status: para, ...(motivo ? { motivo } : {}) },
    })
  }

  /**
   * A carga que vai para a fila — e que, por isso, precisa ser a MESMA usada para emitir a
   * aprovacao. Uma funcao so: duas montagens equivalentes divergem na primeira mudanca, e a
   * divergencia aqui se manifesta como aprovacao valida sendo recusada no despacho.
   */
  private cargaDoEfeito(
    handoff: { id: string; root: string; contentHash: string; name?: string },
    efeito: EfeitoDoHandoff,
  ): Record<string, unknown> {
    // Sessão: o nome do envelope vira o título do PR (12/11 — o prompt truncado era ilegível).
    // Entra na CARGA, então a aprovação cobre também o título que vai ao GitHub.
    const extras = efeito.actionKey === EFEITO_SESSAO && handoff.name ? { nomeDoEnvelope: handoff.name } : {}
    // `contentHash` viaja NA CARGA, e nao so na aprovacao: assim os dois lados o enxergam, e a
    // autorizacao fica presa a VERSAO do envelope, nao so aos argumentos do efeito. Deixa-lo
    // fora do payload tornaria o vinculo com o conteudo impossivel de reproduzir no consumo.
    return {
      ...efeito.payload,
      ...extras,
      root: handoff.root,
      handoffId: handoff.id,
      contentHash: handoff.contentHash,
    }
  }

  /**
   * O isolamento vem do catálogo, e o corpo não pode influenciá-lo.
   *
   * Recusar em voz alta em vez de ignorar em silêncio: um produtor que mandou `isolamento`
   * acreditando estar pedindo proteção precisa saber que aquele campo não é dele — ignorar
   * deixaria a crença intacta, e ela reapareceria como surpresa no dia em que importasse.
   *
   * Efeito sem isolamento declarado é erro, não `'nenhum'`: ausência não é permissão.
   */
  private comIsolamentoDerivado(dto: ConteudoDoHandoff): ConteudoDoHandoff {
    const derivado = isolamentoDoEfeito(dto.efeitos[0].actionKey)
    if (!derivado) {
      throw new BadRequestException(
        `efeito "${dto.efeitos[0].actionKey}" não tem isolamento declarado no catálogo`,
      )
    }
    if (dto.isolamento !== undefined && dto.isolamento !== derivado) {
      throw new BadRequestException(
        `isolamento é declarado pelo catálogo ("${derivado}") e não vem no envelope — quem pede não escolhe a própria proteção`,
      )
    }
    return { ...dto, isolamento: derivado }
  }

  /**
   * Para `supervised_session`, o SERVIDOR cunha a `AgentSession` e injeta o `sessionId`.
   *
   * Mesma disciplina do isolamento: quem pede não escolhe a própria identidade. Um `sessionId`
   * vindo do corpo poderia apontar para a sessão de outro envelope — e o branch, a fila de
   * perguntas e a entrega dela — então é recusado em voz alta, não ignorado.
   *
   * `publicar` precisa ser booleano literal quando presente: é o efeito externo (push + PR) e
   * entra no hash aprovado; `"true"` em string seria pedido ambíguo.
   */
  private async comSessaoCunhada(dto: ConteudoDoHandoff): Promise<{ dto: ConteudoDoHandoff; sessionId?: string }> {
    const efeito = dto.efeitos[0]
    if (efeito.actionKey !== EFEITO_SESSAO) return { dto }
    const payload = this.payloadDaSessao(efeito.payload)
    if ('sessionId' in (efeito.payload ?? {})) {
      throw new BadRequestException('sessionId é cunhado pelo servidor e não vem no envelope')
    }
    const projeto = await (this.prisma as any).project.findUnique({ where: { id: payload.projectId }, select: { id: true } })
    if (!projeto) throw new NotFoundException(`Projeto ${payload.projectId} não encontrado`)

    const sessao = await this.prisma.agentSession.create({
      data: { projectId: payload.projectId, claudePrompt: payload.prompt, status: 'pending' },
    })
    return {
      dto: { ...dto, efeitos: [{ ...efeito, payload: { ...payload, sessionId: sessao.id } }] },
      sessionId: sessao.id,
    }
  }

  /** Editar mantém a MESMA sessão (e o mesmo branch); prompt/projeto acompanham a edição. */
  private async comSessaoPreservada(
    atual: { effects: unknown },
    dto: ConteudoDoHandoff,
  ): Promise<ConteudoDoHandoff> {
    const efeito = dto.efeitos[0]
    if (efeito.actionKey !== EFEITO_SESSAO) return dto
    const anterior = this.efeitosDe(atual.effects)[0]
    const sessionId = anterior?.actionKey === EFEITO_SESSAO ? anterior.payload?.sessionId : undefined
    if (typeof sessionId !== 'string') {
      throw new BadRequestException('o envelope original não é uma sessão supervisionada — crie outro envelope')
    }
    const payload = this.payloadDaSessao(efeito.payload)
    if ('sessionId' in (efeito.payload ?? {}) && efeito.payload.sessionId !== sessionId) {
      throw new BadRequestException('sessionId é cunhado pelo servidor e não muda na edição')
    }
    await this.prisma.agentSession.update({
      where: { id: sessionId },
      data: { projectId: payload.projectId, claudePrompt: payload.prompt },
    })
    return { ...dto, efeitos: [{ ...efeito, payload: { ...payload, sessionId } }] }
  }

  /**
   * Item 7.3 (decidido 13/11): o envelope declara como a sessão é supervisionada.
   * `por_entrega` — roda as etapas sozinha no worktree e para UMA vez, no diff completo antes
   * de publicar; `por_etapa` — para em cada etapa, como era antes.
   *
   * Sempre gravado EXPLÍCITO, mesmo quando o corpo omite (padrão `por_entrega`): quem aprova
   * vê o modo no envelope e o hash o cobre. O agent trata ausência como `por_etapa`, que é o
   * significado que os envelopes anteriores tinham quando foram aprovados.
   */
  private payloadDaSessao(bruto: Record<string, unknown> | undefined): { projectId: string; prompt: string; publicar?: boolean; aprovacao: ModoDeAprovacao; baseRef?: string } {
    const p = bruto ?? {}
    if (typeof p.projectId !== 'string' || !p.projectId.trim()) {
      throw new BadRequestException('sessão supervisionada exige payload.projectId — o checkout é resolvido pelo projeto')
    }
    if (typeof p.prompt !== 'string' || !p.prompt.trim()) {
      throw new BadRequestException('sessão supervisionada exige payload.prompt')
    }
    if (p.publicar !== undefined && typeof p.publicar !== 'boolean') {
      throw new BadRequestException('payload.publicar precisa ser booleano')
    }
    if ('projectPath' in p) {
      // Caminho livre contornaria a resolução por projeto (Fase 3): a sessão escreve código.
      throw new BadRequestException('projectPath não é aceito em envelope — use projectId')
    }
    if (p.aprovacao !== undefined && !MODOS_DE_APROVACAO.includes(p.aprovacao as ModoDeAprovacao)) {
      throw new BadRequestException(`payload.aprovacao precisa ser ${MODOS_DE_APROVACAO.join(' ou ')}`)
    }
    // G6.6 (21/11): esta lista de campos é de PERMISSÃO, e o `baseRef` da fatia 4 não estava nela —
    // a rotina pedia "parta do ramo do PR" e o envelope gravava sem, então a sessão partiria do
    // `main`, sem o erro. Medido no primeiro disparo real. Entra no hash: quem aprova vê o ramo.
    if (p.baseRef !== undefined && !refDeBaseValida(p.baseRef)) {
      throw new BadRequestException('payload.baseRef precisa ser um nome de ramo (sem espaço, sem "..", sem "-" no início)')
    }
    return {
      projectId: p.projectId.trim(),
      prompt: p.prompt,
      ...(p.publicar !== undefined ? { publicar: p.publicar } : {}),
      aprovacao: (p.aprovacao as ModoDeAprovacao | undefined) ?? 'por_entrega',
      ...(p.baseRef !== undefined ? { baseRef: p.baseRef } : {}),
    }
  }

  private efeitosDe(valor: unknown): EfeitoDoHandoff[] {
    return Array.isArray(valor) ? (valor as EfeitoDoHandoff[]) : []
  }

  private validarConteudo(dto: ConteudoDoHandoff) {
    if (!dto.name?.trim()) throw new BadRequestException('name é obrigatório')
    if (!dto.brief?.trim()) throw new BadRequestException('brief é obrigatório')
    if (!dto.root?.trim()) throw new BadRequestException('root é obrigatório')
    // ── Um efeito por envelope é a REGRA, não o escopo de um incremento ──────
    //
    // Decidido em 25/09 (`docs/decisions/handoff-efeitos-plurais.md`): toda garantia desta
    // fase é POR EFEITO — hash do alvo, aprovação de consumo único, chave de idempotência,
    // fencing token, prévia e reconciliação. Um envelope com N efeitos pediria atomicidade
    // entre eles, que é exatamente o que o plano declara não prometer. Vários efeitos são
    // vários envelopes, cada um com a sua aprovação e a sua ordem declarada.
    //
    // Recusar na ESCRITA, e não só no gate de aprovação: aceitar o rascunho e reprovar
    // depois deixaria o autor descobrir a regra no aceite, com os efeitos 2..N já dentro do
    // hash do conteúdo e nenhum deles com caminho para executar.
    if (!Array.isArray(dto.efeitos) || dto.efeitos.length !== 1) {
      throw new BadRequestException(
        dto.efeitos?.length
          ? `um efeito por envelope — recebidos ${dto.efeitos.length}; vários efeitos são vários envelopes, cada um com a sua aprovação`
          : 'efeitos é obrigatório — envelope sem efeito não autoriza nada',
      )
    }
    for (const efeito of dto.efeitos) {
      if (!efeito?.actionKey?.startsWith('jarvis:')) {
        throw new BadRequestException(`efeito inválido: actionKey precisa começar com "jarvis:" (recebido: "${efeito?.actionKey}")`)
      }
    }
  }
}

/** Estados em que o envelope já foi aprovado e o executor está com ele (ou conferindo o efeito). */
export const ESTADOS_EM_ANDAMENTO = ['queued', 'claimed', 'executing', 'reconciling'] as const

/**
 * A "etapa atual" que o cartão mostra: a última linha não vazia do log ao vivo, sem os
 * marcadores de ANSI que sobrarem, cortada em 160 caracteres. Sem log, `null`.
 */
export function ultimaLinhaDoLog(log: string | null): string | null {
  if (!log) return null
  const linhas = log.split(/\r?\n/).map((l) => l.replace(/\u001b\[[0-9;]*m/g, '').trim()).filter(Boolean)
  const ultima = linhas[linhas.length - 1]
  return ultima ? ultima.slice(0, 160) : null
}

/**
 * O que o cartão de entrega mostra da verificação independente (G2.7): o status e o comando.
 * As últimas linhas ficam no PR; aqui não cabem. Formato desconhecido vira `null`, nunca "passou".
 */
export function resumoDaVerificacao(bruto: unknown): { status: string; comando: string } | null {
  if (!bruto || typeof bruto !== 'object' || Array.isArray(bruto)) return null
  const v = bruto as Record<string, unknown>
  const status = typeof v.status === 'string' ? v.status : null
  if (!status || !['passou', 'falhou', 'timeout', 'não verificado'].includes(status)) return null
  return { status, comando: typeof v.comando === 'string' ? v.comando.slice(0, 120) : '' }
}

/**
 * G2.11: quem cria envelope "de dentro do Hub". `mcp:hermes` é a conversa do fio; `rotina:<id>` é
 * uma rotina do projeto; `hub:<hash>` é um toque de pessoa no Hub (a continuação do G3.2). Proposta
 * vinda de fora (Claude Code pelo MCP, por exemplo) continua esperando o "vincular" manual.
 */
export function nasceuNoHub(criadoPor: string): boolean {
  return criadoPor === 'mcp:hermes' || /^rotina:[\w-]+$/.test(criadoPor) || /^hub:[0-9a-f]{12}$/.test(criadoPor)
}
