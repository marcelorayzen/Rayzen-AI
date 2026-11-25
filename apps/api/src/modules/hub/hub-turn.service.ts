import { BadGatewayException, HttpException, Injectable, Logger, NotFoundException, Optional, ServiceUnavailableException } from '@nestjs/common'
import { randomBytes, randomUUID } from 'crypto'
import { PrismaService } from '../../prisma/prisma.service'
import { HubThreadService } from './hub-thread.service'
import { HermesRuntimeClient, obterTimeoutHermesRuntimeMs } from './hermes-runtime.client'
import { ContextPackClient } from './context-pack.client'
import { PROJETO_GERAL_ID } from '../../common/escopo-geral.const'
import { decidirSessao } from '../session/janela-de-sessao'
import { HubAnexoService } from './hub-anexo.service'
import { montarMensagemComAnexos } from './hub-anexo.const'

type HubThreadRecord = { id: string; hermesSessionId: string | null; projectId?: string | null }
type HubTurnRecord = {
  id: string
  threadId: string
  principalId: string
  idempotencyKey: string
  inputText: string
  createdAt?: Date
  status: string
  outputText: string | null
  errorCode: string | null
  runtimeRunId: string | null
  contextPackId?: string | null
  contextPackHash?: string | null
  anexoIds?: string[]
}
type HubEventRecord = { sequence: number; type: string; payload: unknown; createdAt: Date }

type HubDelegate = {
  findUnique(args: unknown): Promise<HubTurnRecord | null>
  findFirst(args: unknown): Promise<{ createdAt: Date } | null>
  create(args: unknown): Promise<HubTurnRecord>
  update(args: unknown): Promise<HubTurnRecord>
  updateMany(args: unknown): Promise<{ count: number }>
}

/** Por que a sessão do Hermes deste turno é nova — `null` quando continua a mesma. */
export type MotivoDeSessaoNova = 'primeira' | 'nova_conversa' | 'inatividade' | null
type HubThreadDelegate = { update(args: unknown): Promise<HubThreadRecord> }
type HubEventDelegate = {
  create(args: unknown): Promise<unknown>
  findMany(args: unknown): Promise<HubEventRecord[]>
}
type HubDb = { hubTurn: HubDelegate; hubThread: HubThreadDelegate; hubEvent: HubEventDelegate }

/** Persistência, idempotência e correlação da fachada H2. */
/**
 * HC7c: no modo conversa a resposta é FALADA. Uma resposta típica do Hub tem 1.107 caracteres
 * (mediana de `hub_turns`), cerca de 30 s de fala, e lista ou tabela lidas em voz soam mal.
 * Decidido pelo Marcelo em 23/11: resposta curta, oferecendo continuar.
 *
 * Vai no contexto do turno, não no pedido: muda a FORMA da resposta e nada mais. Não troca
 * ferramenta, não dispensa cartão, não autoriza nada; o que muda algo continua virando cartão.
 */
export const NOTA_DE_CONVERSA_POR_VOZ =
  '[MODO CONVERSA POR VOZ] Esta resposta será falada em voz alta. Responda em até 4 frases curtas, ' +
  'em português falado, sem listas, tabelas, títulos, código nem markdown. Se o assunto pedir mais, ' +
  'responda o essencial e ofereça continuar ("quer que eu siga?"). Isto muda só a forma da ' +
  'resposta: ferramentas, cartões e aprovações seguem exatamente as mesmas regras.'

@Injectable()
export class HubTurnService {
  private readonly logger = new Logger(HubTurnService.name)
  private readonly caudaPorFio = new Map<string, Promise<unknown>>()
  private readonly turnosEnfileirados = new Set<string>()
  private readonly aguardandoPorFio = new Map<string, number>()
  private readonly limiteDeEsperaPorFio = 5

  constructor(
    private readonly prisma: PrismaService,
    private readonly threads: HubThreadService,
    private readonly runtime: HermesRuntimeClient,
    private readonly contextPacks: ContextPackClient,
    // HC2: opcional para os testes antigos, que constroem o serviço sem anexos.
    @Optional() private readonly anexos?: HubAnexoService,
  ) {}

  async submit(input: { principalId: string; projectId?: string | null; text: string; idempotencyKey?: string; contextPackId?: string; authorization?: string; novaConversa?: boolean; modo?: 'sync' | 'async'; anexoIds?: string[]; porVoz?: boolean }) {
    const thread = await this.threads.resolveActive(input.principalId, input.projectId)
    const db = this.prisma as unknown as HubDb
    const idempotencyKey = input.idempotencyKey?.trim() || randomUUID()
    const existing = await db.hubTurn.findUnique({
      where: { threadId_idempotencyKey: { threadId: thread.id, idempotencyKey } },
    })
    if (existing) return this.serialize(existing, true)

    // Lido ANTES de criar o turno deste pedido — senão o "último turno" seria ele mesmo.
    const motivo = await this.motivoDeSessaoNova(thread, input.novaConversa === true)

    const contextPack = input.contextPackId ? await this.contextPacks.content(input.contextPackId, input.authorization) : null
    // HC2: anexos conferidos (dono, quantidade, tamanho) ANTES de o turno existir — um id de outra
    // pessoa recusa o pedido inteiro, e nada chega ao modelo.
    const anexoIds = (input.anexoIds ?? []).filter((i) => typeof i === 'string' && i.trim())
    if (anexoIds.length && !this.anexos) throw new ServiceUnavailableException({ code: 'hub_anexos_indisponivel' })
    const anexos = anexoIds.length ? await this.anexos!.paraOTurno(input.principalId, anexoIds) : []
    const mensagem = montarMensagemComAnexos(input.text, anexos, randomBytes(4).toString('hex'))
    this.reservarVaga(thread.id)
    let enfileirado = false
    try {
      let turn: HubTurnRecord
      try {
        turn = await db.hubTurn.create({
          data: { threadId: thread.id, principalId: input.principalId, idempotencyKey, inputText: input.text, status: 'accepted', contextPackId: contextPack?.id, contextPackHash: contextPack?.snapshotHash, ...(anexoIds.length ? { anexoIds } : {}) },
        })
      } catch {
        // Concorrência com a mesma chave: nunca submete duas vezes ao runtime.
        const raced = await db.hubTurn.findUnique({
          where: { threadId_idempotencyKey: { threadId: thread.id, idempotencyKey } },
        })
        if (raced) return this.serialize(raced, true)
        throw new BadGatewayException({ code: 'hub_turn_persistence_failed' })
      }
      await this.event(turn.id, 1, 'turn.accepted', { threadId: thread.id, ...(motivo ? { sessaoNova: motivo } : {}), ...(input.porVoz === true ? { porVoz: true } : {}) })

      const hermesSessionId = motivo ? randomUUID() : thread.hermesSessionId!
      if (motivo) {
        await db.hubThread.update({ where: { id: thread.id }, data: { hermesSessionId } })
      }

      const escopo = await this.blocoDeEscopo(thread)
      const contexto = [escopo, input.porVoz === true ? NOTA_DE_CONVERSA_POR_VOZ : null, contextPack?.text].filter(Boolean).join('\n\n')
      const execucao = this.enfileirar(turn, thread, hermesSessionId, contexto, mensagem)
      enfileirado = true
      if (input.modo === 'async') {
        void execucao.catch((error: unknown) => this.logger.error(`Falha ao executar turno Hub ${turn.id}: ${String(error)}`))
        return this.serialize(turn, false)
      }
      return await execucao
    } finally {
      if (!enfileirado) this.liberarVaga(thread.id)
    }
  }

  async events(principalId: string, turnId: string) {
    const turn = await this.resolverTurno(principalId, turnId)
    const db = this.prisma as unknown as HubDb
    const events = await db.hubEvent.findMany({ where: { turnId }, orderBy: { sequence: 'asc' } })
    return { turnId, events: events.map(({ sequence, type, payload, createdAt }) => ({ sequence, type, payload, createdAt })) }
  }

  async get(principalId: string, turnId: string) {
    const turn = await this.resolverTurno(principalId, turnId)
    return this.serialize(turn, false)
  }

  private async resolverTurno(principalId: string, turnId: string) {
    const db = (this.prisma as unknown as HubDb).hubTurn
    let turn = await db.findUnique({ where: { id: turnId } })
    if (!turn || turn.principalId !== principalId) throw new NotFoundException()
    if (this.turnosEnfileirados.has(turn.id)) return turn
    const limiteMs = obterTimeoutHermesRuntimeMs() + 60_000
    if (turn.status !== 'accepted' || !turn.createdAt || Date.now() - turn.createdAt.getTime() <= limiteMs) return turn

    const resultado = await db.updateMany({
      where: { id: turnId, status: 'accepted' },
      data: { status: 'failed', errorCode: 'hub_turn_interrupted', completedAt: new Date() },
    })
    if (resultado.count === 1) {
      await this.event(turnId, 2, 'turn.failed', { code: 'hub_turn_interrupted' })
    }

    turn = await db.findUnique({ where: { id: turnId } })
    if (!turn || turn.principalId !== principalId) throw new NotFoundException()
    return turn
  }

  /**
   * A sessão do Hermes se renova; o fio do Rayzen continua (13/11).
   *
   * Até aqui o fio guardava UM `hermesSessionId`, cunhado no primeiro turno e reusado para
   * sempre. Medido em 13/11: o Geral tinha 53 mensagens numa sessão só, e o Hermes CONGELA
   * prompt de sistema e lista de ferramentas por sessão (`run_turn_runner.py`, "frozen system
   * prompt + tool schemas → prompt cache"). Resultado: `rayzen_propose_project` registrada e
   * oferecida pelo MCP, e o modelo do Geral sem vê-la — e coerente com o próprio histórico
   * ("não consigo criar"), mesmo depois de o "+ Nova conversa" da web ter aberto outro fio lá.
   *
   * Renova em dois casos, decididos por Marcelo: a pessoa pediu ("+ Nova conversa"), ou o fio
   * ficou parado além da janela de sessão — a MESMA de `janela-de-sessao.ts` (30 min,
   * `SESSION_JANELA_MIN`), para web, Telegram e Hub concordarem sobre quando uma conversa acaba.
   * O que importa não se perde: a memória mora no Rayzen e o Hub a lê pelas ferramentas.
   *
   * Falha ao ler o último turno mantém a sessão: degradar para o comportamento anterior é
   * melhor que derrubar o turno por uma pergunta de conveniência.
   */
  private async motivoDeSessaoNova(thread: HubThreadRecord, novaConversa: boolean): Promise<MotivoDeSessaoNova> {
    if (!thread.hermesSessionId) return 'primeira'
    if (novaConversa) return 'nova_conversa'
    let ultimo: { createdAt: Date } | null
    try {
      ultimo = await (this.prisma as unknown as HubDb).hubTurn.findFirst({
        where: { threadId: thread.id }, orderBy: { createdAt: 'desc' }, select: { createdAt: true },
      })
    } catch {
      return null
    }
    if (!ultimo) return null
    const decisao = decidirSessao({ sessionId: thread.hermesSessionId, ultimaAtividade: ultimo.createdAt }, () => '')
    return decisao.retomada ? null : 'inatividade'
  }

  /**
   * O fio diz ao runtime de que projeto ele é — a cada turno, gerado pelo SERVIDOR (item 7.5).
   *
   * Medido em 12/11: no fio `rayzen-marcenaria` o Hermes chamou `rayzen_get_state` com `{}` e
   * respondeu com o estado do Rayzen AI. Sozinho, este bloco seria só instrução — e instrução foi
   * o que falhou. Ele existe para o modelo saber QUAL projectId passar; quem impede o erro é o MCP,
   * que recusa leitura sem projectId vinda do Hermes (`projeto-padrao.mjs`).
   *
   * O nome é cortesia: se a leitura falhar, o id basta, e o turno não pode cair por isso.
   */
  private async blocoDeEscopo(thread: HubThreadRecord): Promise<string> {
    const projectId = thread.projectId ?? null
    if (!projectId || projectId === PROJETO_GERAL_ID) {
      return '[ESCOPO DO FIO] Escopo Geral: nenhum projeto está assumido. Para consultar um projeto, ' +
        'descubra o projectId com rayzen_list_projects e diga qual assumiu antes de afirmar algo sobre ele.'
    }
    let nome: string | null = null
    try {
      const projeto = await (this.prisma as any).project.findUnique({ where: { id: projectId }, select: { name: true } })
      nome = projeto?.name ?? null
    } catch { /* o id basta */ }
    return `[ESCOPO DO FIO] Este fio pertence ao projeto ${nome ? `"${nome}" ` : ''}(projectId=${projectId}). ` +
      `Em TODA ferramenta rayzen_* passe projectId="${projectId}". Dado de outro projeto só entra ` +
      'se você disser explicitamente de qual projeto ele é. O que não estiver nas ferramentas ou no ' +
      'contexto, diga que não sabe — não afirme estrutura de arquivos que você não leu.'
  }

  private async event(turnId: string, sequence: number, type: string, payload: object) {
    const db = this.prisma as unknown as HubDb
    await db.hubEvent.create({ data: { turnId, sequence, type, payload } })
  }

  private reservarVaga(threadId: string) {
    const aguardando = this.aguardandoPorFio.get(threadId) ?? 0
    if (aguardando >= this.limiteDeEsperaPorFio) {
      throw new HttpException({ code: 'hub_turn_queue_full' }, 429)
    }
    this.aguardandoPorFio.set(threadId, aguardando + 1)
  }

  private liberarVaga(threadId: string) {
    const aguardando = this.aguardandoPorFio.get(threadId) ?? 0
    if (aguardando <= 1) this.aguardandoPorFio.delete(threadId)
    else this.aguardandoPorFio.set(threadId, aguardando - 1)
  }

  private enfileirar(turn: HubTurnRecord, thread: HubThreadRecord, hermesSessionId: string, contexto: string, mensagem: string) {
    const anterior = this.caudaPorFio.get(thread.id) ?? Promise.resolve()
    this.turnosEnfileirados.add(turn.id)

    const trabalho = () => {
      this.liberarVaga(thread.id)
      return this.executar(turn, thread, hermesSessionId, contexto, mensagem)
    }
    const execucao = anterior.then(trabalho, trabalho)
    const cauda = execucao.then(() => undefined, () => undefined)
    this.caudaPorFio.set(thread.id, cauda)
    void cauda.then(() => {
      this.turnosEnfileirados.delete(turn.id)
      if (this.caudaPorFio.get(thread.id) === cauda) this.caudaPorFio.delete(thread.id)
    })
    return execucao
  }

  /** `mensagem` é o pedido com os anexos já em blocos (HC2); sem anexo, é o próprio `inputText`. */
  private async executar(turn: HubTurnRecord, _thread: HubThreadRecord, hermesSessionId: string, contexto: string, mensagem: string) {
    try {
      const reply = await this.runtime.sendText({
        sessionId: hermesSessionId,
        text: mensagem,
        idempotencyKey: turn.idempotencyKey,
        context: contexto,
      })
      const completed = await (this.prisma as unknown as HubDb).hubTurn.update({
        where: { id: turn.id },
        data: { status: 'completed', outputText: reply.text, runtimeRunId: reply.runtimeRunId, completedAt: new Date() },
      })
      await this.event(turn.id, 2, 'turn.completed', { runtimeRunId: reply.runtimeRunId })
      return this.serialize(completed, false)
    } catch (error) {
      const code = this.errorCode(error)
      await (this.prisma as unknown as HubDb).hubTurn.update({
        where: { id: turn.id }, data: { status: 'failed', errorCode: code, completedAt: new Date() },
      })
      await this.event(turn.id, 2, 'turn.failed', { code })
      throw error
    }
  }

  private serialize(turn: HubTurnRecord, replayed: boolean) {
    return {
      turnId: turn.id,
      threadId: turn.threadId,
      inputText: turn.inputText,
      status: turn.status,
      outputText: turn.outputText,
      errorCode: turn.errorCode,
      runtimeRunId: turn.runtimeRunId,
      contextPackId: turn.contextPackId ?? null,
      contextPackHash: turn.contextPackHash ?? null,
      anexoIds: turn.anexoIds ?? [],
      replayed,
    }
  }

  private errorCode(error: unknown) {
    if (error instanceof HttpException) {
      const response = error.getResponse()
      if (typeof response === 'object' && response && 'code' in response && typeof response.code === 'string') {
        return response.code
      }
    }
    return 'hub_runtime_failed'
  }
}
