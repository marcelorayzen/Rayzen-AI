import { Injectable } from '@nestjs/common'
import { randomUUID } from 'crypto'
import { PrismaService } from '../../prisma/prisma.service'
import { decidirSessao, type DecisaoDeSessao } from './janela-de-sessao'
import { FORA_AS_SONDAS } from './sonda-de-sensor.const'
import { pareceDecisao } from '../../common/decisao-declarada.const'
import { escopoDeRegistro, PROJETO_GERAL_ID } from '../../common/escopo-geral.const'

@Injectable()
export class SessionService {
  constructor(private readonly prisma: PrismaService) {}

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
    const projectId = escopoDeRegistro(entrada.projectId)
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

    let evento = false
    if (texto && pareceDecisao(texto)) {
      await this.prisma.event.create({
        data: {
          projectId,
          source:  'hub',
          type:    'decision',
          content: texto.slice(0, 2000),
          metadata: { sessionId: entrada.sessionId, canal: 'hub', model: entrada.model ?? null },
        },
      })
      evento = true
    }

    return { gravado: true, evento }
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
}
