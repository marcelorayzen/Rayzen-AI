// Task types (shared entre API e Agent)
export type TaskStatus = 'pending' | 'processing' | 'done' | 'failed'
// TaskModule: valores literais NÃO mudam — usados em runtime pelo executor.ts e whitelist.ts do agent
export type TaskModule = 'jarvis' | 'content' | 'doc' | 'brain' | 'system'
// TaskDomain: alias semântico para uso em código novo
export type TaskDomain = TaskModule

export interface Task {
  id: string
  module: TaskModule
  action: string
  payload: Record<string, unknown>
  status: TaskStatus
  targetRole?: string   // 'notebook' | 'desktop' | undefined (any)
  result?: unknown
  error?: string
  createdAt: string
  updatedAt: string
}

export interface TaskCreateDto {
  module: TaskModule
  action: string
  payload: Record<string, unknown>
  targetRole?: string
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
