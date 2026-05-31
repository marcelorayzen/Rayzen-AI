import { Injectable, Logger, NotFoundException } from '@nestjs/common'
import { randomUUID } from 'crypto'
import { LlmService } from '../llm/llm.service'
import { ContextEngineService } from '../context-engine/context-engine.service'
import { RouterService } from '../router/router.service'

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

    return { sessionId: sess.id, contextPreview, route }
  }

  get(sessionId: string): ConversationSession {
    const sess = this.sessions.get(sessionId)
    if (!sess) throw new NotFoundException(`Conversation session ${sessionId} not found`)
    return sess
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
