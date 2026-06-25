import { SKILL_DEFINITIONS_EXPORT } from '../skill-engine/skill-registry'
import type { AIToolDefinition } from '../ai-router/ai-router.service'

export type SpecialistType = 'coder' | 'reviewer' | 'tester' | 'architect' | 'researcher' | 'debugger' | 'synthesizer'

export interface SpecialistDefinition {
  type:             SpecialistType
  name:             string
  systemPrompt:     string
  allowedSkills:    string[]     // subset of Skill Registry
  maxIterations:    number
  maxCostUsd:       number
  model:            string       // AI Router tier alias
  requiresApproval: boolean
}

export const SPECIALIST_DEFINITIONS: Record<SpecialistType, SpecialistDefinition> = {
  coder: {
    type:    'coder',
    name:    'Software Engineer',
    systemPrompt: `You are an expert software engineer. Your task is to implement code changes.
- Write clean, production-ready TypeScript/JavaScript code
- Follow existing patterns in the codebase
- Include error handling and type safety
- Return your implementation with clear file paths and code blocks
- When done, summarize what was implemented`,
    allowedSkills:    ['jarvis:git_status', 'jarvis:git_log', 'jarvis:file_search', 'jarvis:file_read', 'jarvis:file_write', 'jarvis:run_tests'],
    // run_command removido — coder não deve executar comandos arbitrários; só debugger precisa disso
    maxIterations:    10,
    maxCostUsd:       1.50,
    model:            'gpt-4o',
    requiresApproval: false,
  },

  reviewer: {
    type:    'reviewer',
    name:    'Code Reviewer',
    systemPrompt: `You are a senior code reviewer. Your task is to review code changes.
- Check for security vulnerabilities, performance issues, and code quality
- Verify type safety and error handling
- Check adherence to project conventions
- Provide actionable feedback with specific line references
- Give a final verdict: APPROVE / REQUEST_CHANGES`,
    allowedSkills:    ['jarvis:git_status', 'jarvis:git_log', 'jarvis:file_search', 'jarvis:file_read', 'jarvis:git_diff'],
    maxIterations:    5,
    maxCostUsd:       0.50,
    model:            'gpt-4o',
    requiresApproval: false,
  },

  tester: {
    type:    'tester',
    name:    'QA Engineer',
    systemPrompt: `You are a QA engineer specializing in automated testing.
- Write comprehensive test cases (unit, integration, e2e)
- Cover edge cases, error paths, and happy paths
- Use the project's existing test framework (jest/vitest/playwright)
- Run tests and report results
- Return test coverage summary`,
    allowedSkills:    ['jarvis:run_tests', 'jarvis:parse_test_report', 'jarvis:file_search', 'jarvis:git_status'],
    maxIterations:    8,
    maxCostUsd:       0.80,
    model:            'gpt-4o',
    requiresApproval: false,
  },

  architect: {
    type:    'architect',
    name:    'Software Architect',
    systemPrompt: `You are a software architect making high-level design decisions.
- Design scalable, maintainable system architecture
- Consider trade-offs between different approaches
- Document decisions as ADRs (Architecture Decision Records)
- Include diagrams in Mermaid format when helpful
- Return a complete architecture document`,
    allowedSkills:    ['jarvis:inspect_schema', 'jarvis:file_search', 'jarvis:git_log'],
    maxIterations:    6,
    maxCostUsd:       2.00,
    model:            'gpt-4o-premium',
    requiresApproval: false,
  },

  researcher: {
    type:    'researcher',
    name:    'Technical Researcher',
    systemPrompt: `You are a technical researcher. Your task is to read files, inspect schemas, and produce factual reports.
- Use file_read to read the exact file content when a specific file path is given
- Use file_search to find files when only a name or pattern is given
- Report facts literally — do NOT infer or invent data
- Structure your output clearly with sections and lists
- When you have read and understood the material, return a complete report and signal DONE`,
    allowedSkills:    ['jarvis:file_search', 'jarvis:file_read', 'jarvis:git_log', 'jarvis:inspect_schema'],
    // file_read adicionado — sem ele o researcher nao conseguia ler conteudo de arquivos,
    // apenas encontra-los. Coder era inferido por default e usava run_command desnecessariamente.
    maxIterations:    6,
    maxCostUsd:       0.60,
    model:            'gpt-4o',
    requiresApproval: false,
  },

  debugger: {
    type:    'debugger',
    name:    'Debugging Specialist',
    systemPrompt: `You are a debugging specialist. Your task is to identify and fix bugs.
- Reproduce the issue systematically
- Identify the root cause with evidence
- Propose and implement a targeted fix
- Verify the fix doesn't introduce regressions
- Return: root cause, fix applied, verification results`,
    allowedSkills:    ['jarvis:run_tests', 'jarvis:file_search', 'jarvis:file_read', 'jarvis:file_write', 'jarvis:git_log', 'jarvis:run_command', 'jarvis:docker_logs'],
    maxIterations:    10,
    maxCostUsd:       1.20,
    model:            'gpt-4o',
    requiresApproval: false,
  },

  synthesizer: {
    type:    'synthesizer',
    name:    'Document Synthesizer',
    systemPrompt: `You are a technical writer and analyst.
Your task is to synthesize information from provided context and produce structured documents.
- Use ONLY the information available in the context and prevOutputs — do NOT search for more data
- Write in clear, structured Markdown
- If asked to summarize an analysis, quote the findings literally from the context
- If the context contains "## Previous step outputs", use those as your primary source
- When done, return the complete document content and signal DONE`,
    allowedSkills:    [],   // sem tools — o contexto já está no prompt via prevOutputs
    maxIterations:    3,
    maxCostUsd:       0.30,
    model:            'gpt-4o-premium',   // Claude Sonnet — melhor para síntese e escrita
    requiresApproval: false,
  },
}

// Anthropic exige que nomes de tool sigam ^[a-zA-Z0-9_-]{1,128}$.
// Skills com id "jarvis:action" usam ":"  que não é permitido — sanitizamos para "__".
export function toToolName(skillId: string): string { return skillId.replace(/:/g, '__') }
export function fromToolName(name: string):   string { return name.replace(/__/g, ':')  }

// Converte allowedSkills (lista de IDs) em tool definitions no formato esperado pelo
// AiRouterService — só inclui skills que de fato existem no SkillRegistry (defesa contra
// allowedSkills desatualizado referenciando um skillId que não existe mais).
export function buildToolsForSkills(skillIds: string[]): AIToolDefinition[] {
  const bySkillId = new Map(SKILL_DEFINITIONS_EXPORT.map((s) => [s.id, s]))
  return skillIds
    .map((id) => bySkillId.get(id))
    .filter((s): s is NonNullable<typeof s> => Boolean(s))
    .map((skill) => {
      const properties: Record<string, unknown> = {}
      const required: string[] = []
      for (const [field, def] of Object.entries(skill.inputSchema)) {
        if (typeof def === 'string') {
          // Atalho: tipo primitivo simples — sempre obrigatório.
          properties[field] = { type: def }
          required.push(field)
        } else if (def && typeof def === 'object') {
          // Schema completo (ex: campo aninhado tipo objeto) — usa como está,
          // exceto a flag interna `optional` (não é JSON Schema, só controla `required` aqui).
          const { optional, ...schema } = def as Record<string, unknown> & { optional?: boolean }
          properties[field] = schema
          if (!optional) required.push(field)
        }
      }
      return {
        name:        toToolName(skill.id),   // sanitizado para Anthropic
        description: skill.description,
        parameters:  { type: 'object', properties, required },
      }
    })
}

export class SpecialistRegistry {
  get(type: SpecialistType): SpecialistDefinition {
    return SPECIALIST_DEFINITIONS[type] ?? SPECIALIST_DEFINITIONS['researcher']
  }

  list(): SpecialistDefinition[] {
    return Object.values(SPECIALIST_DEFINITIONS)
  }

  has(type: string): type is SpecialistType {
    return Object.prototype.hasOwnProperty.call(SPECIALIST_DEFINITIONS, type)
  }

  // Infer best specialist type from step title/prompt
  infer(text: string): SpecialistType {
    const lower = text.toLowerCase()
    // synthesizer first — avoids "create doc" being caught by coder's "create"
    if (/summarize|resumo|sintetize|sintetiz|document.*write|write.*doc|create.*doc|audit.*doc|relat[oó]rio|escreva.*resumo|crie.*documento/.test(lower)) return 'synthesizer'
    if (/implement|build|develop|code|write.*function/.test(lower))          return 'coder'
    if (/review|check|audit|validate/.test(lower))                           return 'reviewer'
    if (/test|spec|coverage|assert/.test(lower))                             return 'tester'
    if (/architect|design|structure|diagram|\badr\b/.test(lower))           return 'architect'
    // researcher: tarefas de leitura pura (read+report) — antes caia no coder por default,
    // que usava run_command para tentar coletar dados desnecessariamente
    if (/research|analyze|investigate|study|compare|read.*file|list.*type|liste|leia|inspecion|inspect/.test(lower)) return 'researcher'
    if (/debug|fix|error|bug|issue|crash/.test(lower))                       return 'debugger'
    return 'coder' // default
  }
}
