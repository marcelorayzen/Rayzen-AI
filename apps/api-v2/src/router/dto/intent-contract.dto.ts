// Tipos granulares de intenção — derivados de core/skills e core/agents (RIOM v1.0)
export type IntentType =
  | 'generate_code'
  | 'review_code'
  | 'create_test'
  | 'run_tests'
  | 'analyze_failure'
  | 'generate_documentation'
  | 'update_roadmap'
  | 'retrieve_context'
  | 'create_architecture'
  | 'client_discovery'
  | 'deploy'
  | 'database_migration'
  | 'summarize_session'
  | 'request_approval'
  | 'classify_intent'

// Mapeamento IntentType → DecisionType para o dispatcher existente
export const INTENT_TO_ROUTE: Record<IntentType, 'mission' | 'skill' | 'ai' | 'clarification'> = {
  generate_code:          'mission',
  review_code:            'mission',
  create_test:            'mission',
  run_tests:              'mission',
  analyze_failure:        'mission',
  generate_documentation: 'mission',
  create_architecture:    'mission',
  deploy:                 'mission',
  database_migration:     'mission',
  // update_roadmap/client_discovery não têm skill atômica no registry — conversa
  // (a ação real acontece via MCP rayzen_update_planning / fluxo de discovery).
  update_roadmap:         'ai',
  client_discovery:       'ai',
  retrieve_context:       'ai',
  summarize_session:      'ai',
  classify_intent:        'ai',
  request_approval:       'clarification',
}

// IntentType → skillId do registry. Usado quando a rota é 'skill' (modo forçado
// ou skillId explícito). Só mapeia intents que têm uma skill atômica real.
export const INTENT_SKILL: Partial<Record<IntentType, string>> = {
  run_tests: 'jarvis:run_tests',
}

// IntentType → workflow template (fallback quando o LLM não gera steps na missão).
// Chaves devem existir em WORKFLOW_TEMPLATES (implementation | debugging | review).
export const TEMPLATE_FOR_INTENT: Partial<Record<IntentType, 'implementation' | 'debugging' | 'review'>> = {
  generate_code:          'implementation',
  create_test:            'implementation',
  deploy:                 'implementation',
  database_migration:     'implementation',
  create_architecture:    'implementation',
  analyze_failure:        'debugging',
  run_tests:              'debugging',
  review_code:            'review',
  generate_documentation: 'review',
}

// Risco por tipo de intenção — alimenta ApprovalGates e SecurityAgent
export const INTENT_RISK: Record<IntentType, 'low' | 'medium' | 'high'> = {
  retrieve_context:       'low',
  summarize_session:      'low',
  classify_intent:        'low',
  generate_code:          'low',
  review_code:            'low',
  create_test:            'low',
  generate_documentation: 'low',
  create_architecture:    'low',
  update_roadmap:         'low',
  client_discovery:       'low',
  analyze_failure:        'medium',
  run_tests:              'medium',
  request_approval:       'medium',
  database_migration:     'high',
  deploy:                 'high',
}

// Specialist domain hint por IntentType (para SpecialistAgentService.findForTask)
export const INTENT_SPECIALIST: Partial<Record<IntentType, string>> = {
  generate_code:          'coder',
  review_code:            'reviewer',
  create_test:            'tester',
  run_tests:              'tester',
  analyze_failure:        'debugger',
  generate_documentation: 'documentation',
  create_architecture:    'architect',
  database_migration:     'coder',
  deploy:                 'devops',
}

export interface HealthSnapshot {
  degraded: boolean
  unavailableServices: string[]
}

// Artefato central da sessão — produzido pelo classify_intent + JARVISHealthCheck
export interface IntentContract {
  intentType:          IntentType
  confidence:          number
  reasoning:           string
  ambiguous:           boolean
  clarificationNeeded?: string

  projectId:    string
  sessionId?:   string
  rawInput:     string

  successCriteria:  string[]
  riskLevel:        'low' | 'medium' | 'high'
  toolsRequired:    string[]
  environment:      'local' | 'staging' | 'production'

  routeTo:           'mission' | 'skill' | 'ai' | 'clarification'
  specialistDomain?: string

  healthSnapshot: HealthSnapshot

  createdAt: string
}
