import { Injectable, Optional } from '@nestjs/common'
import { randomUUID } from 'crypto'
import { PrismaService } from '../../prisma/prisma.service'
import { decidirSessao, type DecisaoDeSessao } from './janela-de-sessao'
import { FORA_AS_SONDAS } from './sonda-de-sensor.const'
import { pareceDecisao } from '../../common/decisao-declarada.const'
import { escopoDeRegistro, PROJETO_GERAL_ID } from '../../common/escopo-geral.const'
import { HubThreadService } from '../hub/hub-thread.service'

/**
 * Três estados porque `nao-e-decisao` e `falhou` são coisas opostas — um diz que não havia o que
 * gravar, o outro que havia e o banco recusou. Um booleano as colapsaria, que é o defeito de
 * 16/09 (`falhou` virando `vazio`) numa escala menor.
 */
export type RegistroDeDecisao = 'registrado' | 'nao-e-decisao' | 'falhou'

@Injectable()
export class SessionService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly hubThreads?: HubThreadService,
  ) {}

  async getTokenStats() {
    const total = await this.prisma.conversationMessage.aggregate({
      _sum: { tokensUsed: true },
      _count: { id: true },
    })

    const byModule = await this.prisma.conversationMessage.groupBy({
      by: ['module'],
      _sum: { tokensUsed: true },
      _count: { id: true },
      orderBy: { _sum: { tokensUsed: 'desc' } },
    }) as unknown as Array<{ module: string | null; _sum: { tokensUsed: number | null }; _count: { id: number } }>

    const last24h = await this.prisma.conversationMessage.aggregate({
      where: { createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
      _sum: { tokensUsed: true },
      _count: { id: true },
    })

    return {
      total: {
        tokens: total._sum.tokensUsed ?? 0,
        messages: total._count.id,
      },
      last24h: {
        tokens: last24h._sum.tokensUsed ?? 0,
        messages: last24h._count.id,
      },
      byModule: byModule.map((m) => ({
        module: m.module,
        tokens: m._sum.tokensUsed ?? 0,
        messages: m._count.id,
      })),
    }
  }

  async getRecentSessions(limit = 20) {
    // `conversation_messages` guarda DUAS coisas: conversa do usuário e a saída de todo
    // módulo interno que fala com LLM (documentation, synthesis, project-state, graph…).
    // Medido em 19/08: 4.459 sessões de telemetria contra 210 reais — 90,6% das linhas.
    // Agrupar a tabela inteira e cortar em 20 empurrava a primeira conversa real para a
    // posição 661: o histórico exibia 20 linhas idênticas chamadas "Conversa", e nenhuma
    // conversa jamais aparecia.
    //
    // O filtro é "tem mensagem de usuário", não uma lista de módulos nem o prefixo do
    // `session_id`: lista de módulo envelhece a cada módulo novo, e `brain` tem prefixo
    // próprio mas É conversa de verdade. Ter interlocutor humano é o que define a sessão.
    // `FORA_AS_SONDAS` porque "tem interlocutor humano" deixou de bastar: o invariante
    // `embeddings_respondem` busca no Brain para medir, e a busca é persistida como par
    // `user`/`assistant`. Em 18/09 isso tomou **20 de 20** linhas do histórico — o defeito de
    // 19/08 de volta, com outra string.
    const sessoesComUsuario = await this.prisma.conversationMessage.findMany({
      where: { role: 'user', ...FORA_AS_SONDAS },
      distinct: ['sessionId'],
      orderBy: { createdAt: 'desc' },
      select: { sessionId: true },
      take: limit,
    })
    const sessionIdsHumanos = sessoesComUsuario.map((s: { sessionId: string }) => s.sessionId)
    if (sessionIdsHumanos.length === 0) return []

    const sessions = await this.prisma.conversationMessage.groupBy({
      by: ['sessionId'],
      where: { sessionId: { in: sessionIdsHumanos } },
      _count: { id: true },
      _max: { createdAt: true },
      orderBy: { _max: { createdAt: 'desc' } },
      take: limit,
    }) as unknown as Array<{ sessionId: string; _count: { id: number }; _max: { createdAt: Date | null } }>

    const sessionIds = sessions.map((s) => s.sessionId)
    const firstMessages = await this.prisma.conversationMessage.findMany({
      where: { sessionId: { in: sessionIds }, role: 'user' },
      orderBy: { createdAt: 'asc' },
      distinct: ['sessionId'],
    })

    const titleMap = new Map<string, string>(firstMessages.map((m: { sessionId: string; content: string }) => [m.sessionId, m.content]))

    return sessions.map((s) => ({
      sessionId: s.sessionId,
      messages: s._count.id,
      lastActivity: s._max.createdAt,
      title: (titleMap.get(s.sessionId) ?? 'Conversa').slice(0, 50),
    }))
  }

  async getSessionMessages(sessionId: string) {
    return this.prisma.conversationMessage.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'asc' },
      select: { role: true, content: true, module: true, createdAt: true },
    })
  }

  async deleteSession(sessionId: string) {
    await this.prisma.conversationMessage.deleteMany({ where: { sessionId } })
    return { deleted: true }
  }

  /**
   * ── A conversa do HUB entra no MESMO acervo dos outros canais ─────────────
   *
   * Até 18/09 o HUB era um cérebro à parte: memória própria em `state.db` e só ferramentas de
   * **leitura** no Rayzen. O que se conversava lá **não existia** aqui — nem no histórico, nem na
   * síntese, nem na busca. Perguntar depois "o que a gente combinou?" não tinha resposta.
   *
   * Quem empurra é o `post_llm_call` do Hermes, uma vez por turno. O runtime emite; **o modelo não
   * decide o que vale guardar** — que é a diferença entre esta escolha e dar-lhe ferramentas de
   * escrita. A casa tem evidência de sobra de modelo preenchendo formulário: da personality antiga
   * saíram um `decision_log.db`, um watchdog inexistente e uma branch que nunca existiu.
   *
   * ── O evento vem do que a PESSOA disse, nunca do que o modelo respondeu ───
   *
   * Assimetria deliberada. O modelo escrever "decidimos usar X" é ele afirmando; o Marcelo
   * escrever a mesma frase é fato sobre o que foi dito. Registrar a fala do modelo como decisão do
   * projeto seria deixar a timeline ser escrita por quem não decide.
   *
   * E o evento guarda o **texto original**, nunca uma reformulação: um falso positivo do regex
   * vira uma linha ruidosa na timeline, não um fato inventado.
   */
  /**
   * Projeto do fio do Hub dono desta sessão Hermes. `undefined` quando não há fio (o chamador
   * mantém o comportamento anterior); `null` quando o fio é o Geral. Falha de leitura não
   * inventa dono: cai no comportamento anterior, como se não houvesse fio.
   */
  private async projetoDoFio(sessionId: string): Promise<string | null | undefined> {
    if (!sessionId) return undefined
    try {
      const fio = await (this.prisma as any).hubThread?.findFirst({
        where: { hermesSessionId: sessionId },
        select: { projectId: true },
      })
      return fio ? (fio.projectId ?? null) : undefined
    } catch {
      return undefined
    }
  }

  async ingerirTurnoDoHub(entrada: {
    sessionId:         string
    userMessage:       string
    assistantResponse: string
    projectId?:        string | null
    model?:            string | null
  }): Promise<{ gravado: boolean; evento: boolean }> {
    // Registro sempre tem dono desde 18/09: sem projeto explicito, a conversa mora no Geral. E o
    // que tira `registro_sem_projeto` da lista de canais — o geral deixa de ser indistinguivel de
    // um evento que perdeu o dono, porque ele passa a ter um.
    // Item 7.5 (12/11): o FIO decide o dono, não o hook. O `post_llm_call` do Hermes não sabe de
    // que fio do Hub veio o turno e mandava tudo para o Geral — medido: dois turnos do fio
    // `rayzen-marcenaria` gravados no Geral. A sessão Hermes de cada fio está em
    // `hub_threads.hermes_session_id` (o Hub a cunha e a envia em `X-Hermes-Session-Id`), então o
    // servidor resolve sozinho. Sem fio correspondente (Dashboard Hermes direto), vale o de antes.
    // `!== undefined`, não `??`: um fio do GERAL devolve `null`, e ele também decide — com `??` o
    // projeto mandado pelo hook passaria por cima de um fio que existe.
    const doFio     = await this.projetoDoFio(entrada.sessionId)
    const projectId = escopoDeRegistro(doFio !== undefined ? doFio : entrada.projectId)
    const texto     = (entrada.userMessage ?? '').trim()
    const resposta  = (entrada.assistantResponse ?? '').trim()

    // Turno sem nada dito não é conversa. Evita que um `post_llm_call` de aquecimento vire linha.
    if (!texto && !resposta) return { gravado: false, evento: false }

    await this.prisma.conversationMessage.createMany({
      data: [
        { sessionId: entrada.sessionId, module: 'hub', role: 'user',      content: texto,    projectId },
        { sessionId: entrada.sessionId, module: 'hub', role: 'assistant', content: resposta, projectId },
      ],
    })

    const resultado = await this.registrarDecisaoDeclarada({
      texto,
      sessionId: entrada.sessionId,
      projectId,
      canal:     'hub',
      metadata:  { model: entrada.model ?? null },
    })

    return { gravado: true, evento: resultado === 'registrado' }
  }

  /**
   * ── Declarar uma decisão vira evento em QUALQUER canal ──────────────────────
   *
   * Isto nasceu dentro de `ingerirTurnoDoHub` e valia só lá. A consequência, medida em 18/09:
   * declarar uma decisão pelo HUB entrava na timeline do projeto, e declarar **a mesma frase** no
   * chat da web ou no Telegram não entrava em lugar nenhum — os três canais são o mesmo cérebro,
   * a mesma identidade e (desde 18/09) o mesmo fio de conversa, mas só um deles registrava.
   *
   * É a família de `ehTextoDerivadoDeEvento` e das quatro `SAFE_ROOTS` divergentes: a regra estava
   * escrita, estava certa, e estava aplicada num lugar só.
   *
   * ── Por que o `OrchestratorController` é o lugar certo de chamar ────────────
   *
   * Web (streaming), web (não-streaming) e Telegram passam os três por ele — o Telegram fala com a
   * própria api por HTTP (`POST /orchestrate`) justamente para não fechar ciclo de módulo. Um
   * ponto, três canais. Pôr isto nos 10 `createMany` do orquestrador seria espalhar a regra de
   * novo, com cada ramo livre para esquecê-la.
   *
   * ── O que esta função NÃO faz, e é deliberado ───────────────────────────────
   *
   * Não olha a resposta do modelo. O modelo escrever *"decidimos usar X"* é ele afirmando; o
   * Marcelo escrever a mesma frase é fato sobre o que foi dito. Registrar a fala do modelo como
   * decisão do projeto deixaria a timeline ser escrita por quem não decide.
   *
   * E guarda o **texto original**, nunca uma reformulação: falso positivo do regex vira uma linha
   * ruidosa na timeline, não um fato inventado.
   *
   * ── Três estados, nunca dois ────────────────────────────────────────────────
   *
   * `nao-e-decisao` e `falhou` são coisas opostas, e um booleano as colapsaria: um diz que não
   * havia o que gravar, o outro que havia e o banco não aceitou. É a mesma distinção de
   * `fontes-de-contexto.ts` (`ok` · `vazio` · `falhou`) — colapsar as duas é o que faz um defeito
   * parecer ausência.
   *
   * Nunca lança, porque quem chama está no meio de responder a uma pessoa: uma decisão não
   * registrada é uma linha a menos no histórico, e uma exceção aqui derrubaria a resposta.
   */
  async registrarDecisaoDeclarada(entrada: {
    texto:      string
    sessionId:  string
    projectId?: string | null
    canal:      string
    metadata?:  Record<string, unknown>
  }): Promise<RegistroDeDecisao> {
    const texto = (entrada.texto ?? '').trim()
    if (!texto || !pareceDecisao(texto)) return 'nao-e-decisao'

    try {
      await this.prisma.event.create({
        data: {
          projectId: escopoDeRegistro(entrada.projectId),
          source:    entrada.canal,
          type:      'decision',
          content:   texto.slice(0, 2000),
          metadata:  { sessionId: entrada.sessionId, canal: entrada.canal, ...(entrada.metadata ?? {}) },
        },
      })
      return 'registrado'
    } catch {
      return 'falhou'
    }
  }

  /**
   * Em qual conversa escrever agora — a política, num lugar só.
   *
   * **O escopo é o projeto, e `null` é escopo, não curinga.** Pela decisão de 17/09 a conversa sem
   * projeto é o *contexto geral*, deliberado — então ela tem um fio próprio, e não pode ser
   * retomada por um pedido de um projeto específico nem o contrário. `projectId: null` no Prisma é
   * igualdade com NULL, que é exatamente o que se quer aqui.
   *
   * O candidato é a última mensagem **de usuário**, e não a última mensagem qualquer: é o mesmo
   * critério de `getRecentSessions`, e pelo mesmo motivo — telemetria domina a tabela (4.459
   * sessões contra 210 reais, medido em 19/08) e a última linha escrita quase nunca é de conversa.
   * Sem esse filtro, a "sessão a retomar" seria o `session_id` de um refresh de ProjectState.
   */
  async sessaoAtual(projectId: string | null): Promise<DecisaoDeSessao> {
    const ultima = await this.prisma.conversationMessage
      .findFirst({
        // O escopo da sessao usa o Geral como qualquer outro projeto: o fio da conversa geral e
        // dele. Quem continua sem escopo e a BUSCA, nao o registro.
        where:   { role: 'user', projectId: projectId ?? PROJETO_GERAL_ID, ...FORA_AS_SONDAS },
        orderBy: { createdAt: 'desc' },
        select:  { sessionId: true, createdAt: true },
      })
      .catch(() => null)

    // Sem candidata em caso de erro de leitura: começar uma conversa nova é degradação aceitável;
    // retomar a errada, não. Mesma direção do `catch` que já protege as outras consultas daqui.
    const candidata = ultima
      ? { sessionId: ultima.sessionId, ultimaAtividade: ultima.createdAt }
      : null

    return decidirSessao(candidata, () => randomUUID())
  }

  /**
   * Ponte de migração H1: materializa o fio durável antes de aplicar a política
   * histórica de seleção. O `sessionId` continua sendo o contrato dos clientes
   * atuais; H2 passará a usar o `threadId` para encaminhar ao Hermes.
   */
  async sessaoAtualDoPrincipal(principalId: string, projectId: string | null) {
    const thread = this.hubThreads
      ? await this.hubThreads.resolveActive(principalId, projectId)
      : null
    const decision = await this.sessaoAtual(projectId)
    return { ...decision, ...(thread ? { threadId: thread.id } : {}) }
  }
}
