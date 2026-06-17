import { Injectable, Logger, NotFoundException } from '@nestjs/common'
import { randomUUID } from 'crypto'
import { LlmService } from '../llm/llm.service'
import { ContextEngineService } from '../context-engine/context-engine.service'
import { RouterService } from '../router/router.service'
import { MemoryService } from '../memory/memory.service'

export type ConversationStatus = 'gathering' | 'ready' | 'executing' | 'done'

export interface ConversationMessage {
  role:    'user' | 'assistant'
  content: string
  ts:      string
}

export interface ConversationSession {
  id:                string
  projectId:         string
  status:            ConversationStatus
  messages:          ConversationMessage[]
  refinedObjective?: string   // actionable objective once readyToExecute
  lastResult?:       unknown   // route decision + result after execute
  createdAt:         string
  updatedAt:         string
}

export interface ContextPreview {
  totalChars:       number
  estimatedTokens:  number
  sectionsIncluded: string[]
}

const CONVERSATION_SYSTEM = `Você é o Rayzen — um intermediário de contexto entre o usuário e o agente de execução (Claude Code).
Sua função NÃO é executar: é entender a intenção do usuário em português, acumular o pedido e decidir quando ele está pronto para virar uma missão.

Regras:
- Converse em português, de forma curta e direta.
- Se o pedido já é acionável (claro o suficiente para um engenheiro começar), marque readyToExecute=true e escreva um refinedObjective objetivo na primeira pessoa do sistema ("Implementar X em Y respeitando Z").
- Se falta informação essencial, faça UMA pergunta de clarificação por vez (readyToExecute=false). Não faça perguntas óbvias nem peça permissão para começar.
- Use o contexto do projeto fornecido para não pedir o que já se sabe.

Responda SOMENTE com JSON:
{
  "reply": "sua resposta curta ao usuário em PT",
  "readyToExecute": true|false,
  "refinedObjective": "objetivo acionável (só quando readyToExecute=true, senão string vazia)"
}`

@Injectable()
export class ConversationService {
  private readonly logger = new Logger(ConversationService.name)
  private readonly sessions = new Map<string, ConversationSession>()

  constructor(
    private readonly llm:       LlmService,
    private readonly ctxEngine: ContextEngineService,
    private readonly router:    RouterService,
    private readonly memory:    MemoryService,
  ) {}

  /** Fase A — conversa livre: acumula intenção e decide quando está pronto para executar. */
  async message(projectId: string, content: string, sessionId?: string): Promise<{
    sessionId:        string
    reply:            string
    status:           ConversationStatus
    readyToExecute:   boolean
    refinedObjective?: string
  }> {
    const session = sessionId ? this.sessions.get(sessionId) : undefined
    const sess = session ?? this.createSession(projectId)
    const now = new Date().toISOString()

    sess.messages.push({ role: 'user', content, ts: now })

    // Context Broker: ground the conversation in the real project state so Rayzen
    // never asks for what it already knows.
    let brokerCtx = ''
    try {
      const ctx = await this.ctxEngine.build({ projectId, query: content, mode: 'study' })
      brokerCtx = ctx.text
    } catch (e) {
      this.logger.warn(`broker context failed: ${e}`)
    }

    const history = sess.messages.map((m) => ({ role: m.role, content: m.content }))
    const systemContent = brokerCtx
      ? `${CONVERSATION_SYSTEM}\n\nContexto do projeto:\n${brokerCtx}`
      : CONVERSATION_SYSTEM

    let reply = 'Entendido.'
    let readyToExecute = false
    let refinedObjective = ''
    try {
      const result = await this.llm.chat(
        [{ role: 'system', content: systemContent }, ...history],
        { model: 'gpt-4o-mini', temperature: 0.3 },
      )
      const parsed = this.llm.extractJson(result.content) as {
        reply?: string
        readyToExecute?: boolean
        refinedObjective?: string
      }
      reply            = parsed.reply ?? reply
      readyToExecute   = Boolean(parsed.readyToExecute)
      refinedObjective = parsed.refinedObjective ?? ''
    } catch (e) {
      this.logger.warn(`conversation parse error: ${e}`)
      reply = 'Pode detalhar um pouco mais o que você quer fazer?'
    }

    sess.messages.push({ role: 'assistant', content: reply, ts: new Date().toISOString() })
    sess.status = readyToExecute ? 'ready' : 'gathering'
    if (readyToExecute && refinedObjective) sess.refinedObjective = refinedObjective
    sess.updatedAt = new Date().toISOString()

    return {
      sessionId: sess.id,
      reply,
      status: sess.status,
      readyToExecute,
      refinedObjective: sess.refinedObjective,
    }
  }

  /** Fase B→C — usuário confirmou: comprime o contexto e dispara a missão via Router. */
  async execute(sessionId: string, overrideObjective?: string): Promise<{
    sessionId:      string
    contextPreview: ContextPreview
    route:          unknown
  }> {
    const sess = this.sessions.get(sessionId)
    if (!sess) throw new NotFoundException(`Conversation session ${sessionId} not found`)

    const objective = overrideObjective?.trim()
      || sess.refinedObjective
      || [...sess.messages].reverse().find((m) => m.role === 'user')?.content
      || ''

    sess.status = 'executing'
    sess.updatedAt = new Date().toISOString()

    // Snapshot the compressed context that grounds the mission — powers the ContextBadge.
    const contextPreview = await this.previewContext(sess.projectId, objective)

    const route = await this.router.route({
      content:   objective,
      projectId: sess.projectId,
      sessionId: sess.id,
      mode:      'auto',
    })

    sess.lastResult = route
    sess.status = 'done'
    sess.updatedAt = new Date().toISOString()

    // Persist conversation as Brain document so it's semantically searchable in future sessions
    void this.indexConversation(sess, route)

    return { sessionId: sess.id, contextPreview, route }
  }

  get(sessionId: string): ConversationSession {
    const sess = this.sessions.get(sessionId)
    if (!sess) throw new NotFoundException(`Conversation session ${sessionId} not found`)
    return sess
  }

  /**
   * Planeja steps para um objetivo sem criar nada no banco (dry-run).
   * Ideal para mostrar o plano ao usuário antes de confirmar a missão.
   */
  async planMission(dto: { projectId: string; objective: string }) {
    return this.router.plan(dto)
  }

  /**
   * Cria uma Mission diretamente a partir de linguagem natural.
   * Sem necessidade de sessão prévia — NL → Mission + Steps + Gates em uma chamada.
   */
  async toMission(dto: { projectId: string; objective: string; context?: Record<string, unknown> }) {
    return this.router.route({
      projectId: dto.projectId,
      content:   dto.objective,
      context:   dto.context,
      mode:      'mission',
    })
  }

  /**
   * Persiste um único turn (user ou assistant) no Brain (V1 pgvector).
   * Chamado pelo hook do Claude Code após cada interação significativa.
   * O turn fica imediatamente pesquisável via memory_relevant no Context Broker.
   */
  async persistTurn(dto: {
    projectId:  string
    sessionId?: string
    role:       'user' | 'assistant'
    content:    string
    source?:    string
    metadata?:  Record<string, unknown>
  }): Promise<{ documentId: string | null }> {
    const sessionRef = dto.sessionId ?? 'standalone'
    const prefix = dto.source ? `[${dto.source}]` : ''
    const result = await this.memory.store({
      projectId:   dto.projectId,
      content:     `${prefix}[${dto.role}] ${dto.content}`.trim(),
      sourcePath:  `conversation/${sessionRef}/${dto.role}`,
      sourceType:  'conversation',
      memoryClass: 'inbox',
    })
    this.logger.log(`Turn persisted: session=${sessionRef} role=${dto.role} doc=${result.documentId}`)
    return { documentId: result.documentId }
  }

  /**
   * Indexa uma sessão completa como um único Document no Brain.
   * Útil para o hook chamar no fim de uma sessão do Claude Code, enviando o resumo da conversa.
   */
  async indexSession(dto: {
    projectId: string
    sessionId: string
    messages:  Array<{ role: 'user' | 'assistant'; content: string; ts?: string }>
    summary?:  string
  }): Promise<{ documentId: string | null }> {
    const lines: string[] = [
      `# Sessão de conversa: ${dto.sessionId}`,
      `Data: ${new Date().toISOString()}`,
      '',
      '## Mensagens',
    ]
    for (const m of dto.messages) {
      const ts = m.ts ? ` (${m.ts})` : ''
      lines.push(`[${m.role}${ts}] ${m.content}`)
    }
    if (dto.summary) {
      lines.push('', '## Resumo', dto.summary)
    }

    const result = await this.memory.store({
      projectId:   dto.projectId,
      content:     lines.join('\n'),
      sourcePath:  `conversation/session/${dto.sessionId}`,
      sourceType:  'conversation',
      memoryClass: 'working',  // sessão completa vai direto para working
    })
    this.logger.log(`Session indexed: ${dto.sessionId} → doc=${result.documentId}`)
    return { documentId: result.documentId }
  }

  private async previewContext(projectId: string, query: string): Promise<ContextPreview> {
    try {
      const built = await this.ctxEngine.build({ projectId, query, mode: 'architecture' })
      return {
        totalChars:       built.totalChars,
        estimatedTokens:  Math.ceil(built.totalChars / 4),
        sectionsIncluded: Object.keys(built.sections),
      }
    } catch {
      return { totalChars: 0, estimatedTokens: 0, sectionsIncluded: [] }
    }
  }

  private async indexConversation(sess: ConversationSession, route: unknown): Promise<void> {
    try {
      const content = this.formatDocument(sess, route)
      await this.memory.store({
        projectId:  sess.projectId,
        content,
        sourcePath: `conversation/${sess.id}`,
        sourceType: 'conversation',
        memoryClass: 'inbox',
      })
      this.logger.log(`Conversation ${sess.id} indexed in Brain`)
    } catch (e) {
      this.logger.warn(`Failed to index conversation ${sess.id}: ${e}`)
    }
  }

  private formatDocument(sess: ConversationSession, route: unknown): string {
    const lines: string[] = []
    const objective = sess.refinedObjective || sess.messages.find((m) => m.role === 'user')?.content || ''

    lines.push(`# Conversa: ${objective.slice(0, 120)}`)
    lines.push(`Data: ${sess.createdAt}`)
    lines.push(`Sessão: ${sess.id}`)
    lines.push('')
    lines.push('## Mensagens')
    for (const m of sess.messages) {
      lines.push(`[${m.role}] ${m.content}`)
    }

    if (sess.refinedObjective) {
      lines.push('')
      lines.push('## Objetivo refinado')
      lines.push(sess.refinedObjective)
    }

    if (route && typeof route === 'object') {
      const r = route as Record<string, unknown>
      lines.push('')
      lines.push('## Resultado')
      if (r.intentType) lines.push(`Intenção: ${r.intentType}`)
      if (r.routeTo) lines.push(`Roteado para: ${r.routeTo}`)
      if (typeof r.result === 'object' && r.result) {
        const res = r.result as Record<string, unknown>
        if (res.missionId) lines.push(`Missão criada: ${res.missionId}`)
        if (res.stepsCount) lines.push(`Steps: ${res.stepsCount}`)
        if (res.gatesCreated) lines.push(`Gates criados: ${res.gatesCreated}`)
        if (res.answer) lines.push(`Resposta: ${String(res.answer).slice(0, 500)}`)
      }
    }

    return lines.join('\n')
  }

  private createSession(projectId: string): ConversationSession {
    const now = new Date().toISOString()
    const sess: ConversationSession = {
      id: randomUUID(),
      projectId,
      status: 'gathering',
      messages: [],
      createdAt: now,
      updatedAt: now,
    }
    this.sessions.set(sess.id, sess)
    return sess
  }
}
