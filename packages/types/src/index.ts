// Task types (shared entre API e Agent)
export type TaskStatus =
  | 'pending'
  | 'processing'
  | 'done'
  | 'failed'
  | 'effect_unknown'
  | 'failed_safe'
  | 'compensated'
export type AgentRole = 'desktop' | 'server'
export type ReconciliationOutcome = 'effect_confirmed' | 'effect_not_observed' | 'compensated'
// TaskModule: valores literais NÃO mudam — usados em runtime pelo executor.ts e whitelist.ts do agent
export type TaskModule = 'jarvis' | 'content' | 'doc' | 'brain' | 'system'
// TaskDomain: alias semântico para uso em código novo
export type TaskDomain = TaskModule

export interface Task {
  id: string
  module: TaskModule
  action: string
  payload: Record<string, unknown>
  /** Chave da intenção lógica. Reenvios precisam reutilizar esta chave. */
  idempotencyKey?: string
  /** SHA-256 do pedido canônico; a mesma chave com outro hash é conflito. */
  requestHash?: string
  status: TaskStatus
  targetRole?: AgentRole
  /** Token monotônico emitido no claim. Resultado e heartbeat precisam devolver o mesmo token. */
  fencingToken?: string
  result?: unknown
  error?: string
  reconciliation?: {
    outcome: ReconciliationOutcome
    actor: string
    actorType: 'approval_token'
    reason: string
    evidence?: Record<string, unknown>
    resolutionHash: string
    resolvedAt: string
  }
  createdAt: string
  updatedAt: string
}

export interface TaskCreateDto {
  module: TaskModule
  action: string
  payload: Record<string, unknown>
  targetRole?: AgentRole
  idempotencyKey: string
}

// Agent types
export interface AgentCapability {
  action: string
  description: string
  requiresConfirmation: boolean
  allowedPaths?: string[]
}

// Memory types (ex-Brain)
export interface Document {
  id: string
  sourcePath: string
  content: string
  metadata: Record<string, unknown>
  checksum: string
  createdAt: string
  updatedAt: string
}

export interface SearchResult {
  document: Document
  score: number
  excerpt: string
}

// Voice types
export interface VoiceSynthesisRequest {
  text: string
  voice?: string
}

export interface VoiceTranscriptionResult {
  text: string
  confidence?: number
}

// Validation types
export type ValidationSeverity = 'low' | 'medium' | 'high'
export type ValidationIssueType = 'prompt_injection' | 'output_hallucination' | 'schema_violation' | 'length_exceeded'

export interface ValidationIssue {
  type: ValidationIssueType
  severity: ValidationSeverity
  message: string
}

export interface ValidationResult {
  valid: boolean
  issues: ValidationIssue[]
  score: number
}

// LLM types
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface LLMRequest {
  model: string
  messages: ChatMessage[]
  temperature?: number
  stream?: boolean
}

// Rayzen Hub (H0) — contrato de fronteira, ainda sem rota ou persistência.
// O browser só fornece a intenção do turno; identidade, escopo e IDs correlatos
// são resolvidos pela fachada autenticada antes de alcançar o runtime.
export const HUB_CONTRACT_VERSION = '2026-10-12' as const

export type HubScope =
  | { type: 'general' }
  | { type: 'project'; projectId: string }

export type HubThreadStatus = 'active' | 'archived' | 'recovery_required'
export type HubTurnStatus = 'accepted' | 'streaming' | 'completed' | 'failed' | 'interrupted'

export interface HubThread {
  contractVersion: typeof HUB_CONTRACT_VERSION
  threadId: string
  principalId: string
  scope: HubScope
  hermesSessionId: string
  status: HubThreadStatus
  retentionPolicy: string
  createdAt: string
  updatedAt: string
}

export interface HubTurnInput {
  /** Chave por thread: o mesmo valor não pode iniciar dois efeitos no runtime. */
  idempotencyKey: string
  text: string
  attachments?: Array<{ attachmentId: string; filename: string; mediaType: string }>
}

export interface HubTurn {
  contractVersion: typeof HUB_CONTRACT_VERSION
  turnId: string
  threadId: string
  idempotencyKey: string
  status: HubTurnStatus
  input: HubTurnInput
  retrievedContext: Array<{ contextPackId: string; itemIds: string[] }>
  runtime: { provider: 'hermes'; sessionId: string; model: string | null }
  startedAt: string
  completedAt: string | null
  error: { code: string; message: string; retryable: boolean } | null
}

export type HubEventType = 'turn.accepted' | 'turn.delta' | 'turn.completed' | 'turn.failed' | 'turn.interrupted'

export interface HubEvent {
  contractVersion: typeof HUB_CONTRACT_VERSION
  eventId: string
  threadId: string
  turnId: string
  sequence: number
  type: HubEventType
  occurredAt: string
  data: Record<string, unknown>
}

export type HubWorkItemKind = 'plan' | 'capture_proposal' | 'approval' | 'project_handoff' | 'mission' | 'task' | 'result' | 'evidence'

export interface HubWorkItem {
  contractVersion: typeof HUB_CONTRACT_VERSION
  workItemId: string
  threadId: string
  kind: HubWorkItemKind
  sourceSystem: 'v1' | 'v2' | 'agent'
  sourceId: string
  createdAt: string
}
