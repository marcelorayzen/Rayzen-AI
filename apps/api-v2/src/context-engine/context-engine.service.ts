import { Injectable, Logger } from '@nestjs/common'
import { V1BridgeService } from '../core/v1-bridge.service'
import { MemoryService } from '../memory/memory.service'
import { KnowledgeStorageService } from '../knowledge/knowledge-storage.service'
import { PolicyEngineService } from '../policy-engine/policy-engine.service'
import { ApprovalGatesService } from '../approval-gates/approval-gates.service'

export type WorkMode = 'implementation' | 'debugging' | 'review' | 'architecture' | 'study'
export type ContextSection =
  | 'project_state' | 'active_goal' | 'recent_events'
  | 'memory_relevant' | 'planning' | 'blockers'
  | 'knowledge_graph' | 'policy_constraints' | 'approval_gates'

export interface ContextBuildRequest {
  projectId:  string
  taskType?:  string
  mode?:      WorkMode
  query?:     string
  maxTokens?: number
  include?:   ContextSection[]
}

export interface BuiltContext {
  sections:    Partial<Record<ContextSection, string>>
  text:        string           // concatenated, ready to inject into system prompt
  totalChars:  number
  cacheHit:    boolean
  builtAt:     Date
}

export interface SurgicalContext {
  projectId:       string
  task:            string
  mode:            WorkMode
  context:         string        // assembled text, section by section
  readyToInject:   string        // prefixed with "# Rayzen Context", ready for system prompt
  totalChars:      number
  estimatedTokens: number
  sections:        string[]
  builtAt:         Date
}

// Sections included per work mode
const MODE_SECTIONS: Record<WorkMode, ContextSection[]> = {
  implementation: ['project_state', 'planning', 'policy_constraints', 'memory_relevant', 'recent_events', 'approval_gates'],
  debugging:      ['project_state', 'blockers', 'memory_relevant', 'recent_events', 'knowledge_graph', 'approval_gates'],
  review:         ['project_state', 'active_goal', 'memory_relevant', 'planning', 'knowledge_graph'],
  architecture:   ['project_state', 'active_goal', 'planning', 'blockers', 'policy_constraints', 'knowledge_graph'],
  study:          ['project_state', 'memory_relevant', 'recent_events', 'knowledge_graph'],
}

const DEFAULT_SECTIONS: ContextSection[] = [
  'project_state', 'active_goal', 'recent_events',
]

@Injectable()
export class ContextEngineService {
  private readonly logger = new Logger(ContextEngineService.name)
  private readonly cache = new Map<string, { ctx: BuiltContext; expiresAt: number }>()
  private readonly TTL_MS = 5 * 60 * 1000  // 5 min

  constructor(
    private readonly v1Bridge:  V1BridgeService,
    private readonly memory:    MemoryService,
    private readonly knowledge: KnowledgeStorageService,
    private readonly policy:    PolicyEngineService,
    private readonly gates:     ApprovalGatesService,
  ) {}

  async build(req: ContextBuildRequest): Promise<BuiltContext> {
    const cacheKey = `${req.projectId}:${req.mode ?? 'default'}:${req.query ?? ''}`
    const cached = this.cache.get(cacheKey)
    if (cached && cached.expiresAt > Date.now()) {
      return { ...cached.ctx, cacheHit: true }
    }

    const sections = req.include ?? (req.mode ? MODE_SECTIONS[req.mode] : DEFAULT_SECTIONS)
    const maxChars = (req.maxTokens ?? 4000) * 4  // ~4 chars per token

    const built: Partial<Record<ContextSection, string>> = {}
    const parts: string[] = []

    await Promise.all(sections.map(async (section) => {
      try {
        const content = await this.fetchSection(section, req)
        if (content) built[section] = content
      } catch (e) {
        this.logger.warn(`section ${section} failed: ${e}`)
      }
    }))

    // Assemble in order
    for (const section of sections) {
      if (built[section]) {
        parts.push(`### ${sectionLabel(section)}\n${built[section]}`)
      }
    }

    let text = parts.join('\n\n')
    if (text.length > maxChars) {
      text = text.slice(0, maxChars) + '\n... [truncated]'
    }

    const ctx: BuiltContext = {
      sections: built,
      text,
      totalChars: text.length,
      cacheHit:   false,
      builtAt:    new Date(),
    }

    this.cache.set(cacheKey, { ctx, expiresAt: Date.now() + this.TTL_MS })
    return ctx
  }

  invalidateCache(projectId: string) {
    for (const key of this.cache.keys()) {
      if (key.startsWith(projectId)) this.cache.delete(key)
    }
  }

  /**
   * Monta o pacote cirúrgico completo para injeção no Claude.
   * Inclui: ProjectState + Planning + Policy + Knowledge relevante + Memória semântica + Eventos recentes.
   */
  async buildSurgical(req: { projectId: string; task: string; mode?: WorkMode }): Promise<SurgicalContext> {
    const mode = req.mode ?? 'implementation'
    const baseSections = MODE_SECTIONS[mode] ?? DEFAULT_SECTIONS
    // Garante que policy_constraints e knowledge_graph estão sempre presentes no pacote cirúrgico
    const sections = [...new Set([...baseSections, 'policy_constraints' as ContextSection, 'knowledge_graph' as ContextSection])]

    const built = await this.build({
      projectId: req.projectId,
      mode,
      query:     req.task,
      include:   sections,
      maxTokens: 3000,
    })

    const readyToInject = `# Rayzen Context — ${req.task}\n\n${built.text}`

    return {
      projectId:       req.projectId,
      task:            req.task,
      mode,
      context:         built.text,
      readyToInject,
      totalChars:      built.totalChars,
      estimatedTokens: Math.ceil(built.totalChars / 4),
      sections:        Object.keys(built.sections),
      builtAt:         built.builtAt,
    }
  }

  private async fetchSection(section: ContextSection, req: ContextBuildRequest): Promise<string> {
    switch (section) {
      case 'project_state': {
        const state = await this.v1Bridge.getProjectState(req.projectId)
        if (!state) return ''
        const parts = [
          state.objective ? `Objective: ${state.objective}` : '',
          state.stage     ? `Stage: ${state.stage}` : '',
        ].filter(Boolean)
        return parts.join('\n')
      }

      case 'active_goal': {
        const goal = await this.v1Bridge.getProjectGoal(req.projectId)
        if (!goal) return ''
        const criteria = Array.isArray(goal.successCriteria)
          ? (goal.successCriteria as Array<Record<string, unknown>>)
              .map((c) => {
                const text = nodeLabel(c)
                const done = Boolean(c.done ?? c.completed ?? c.checked)
                return text ? `- [${done ? 'x' : ' '}] ${text}` : ''
              })
              .filter(Boolean)
              .join('\n')
          : ''
        return `Goal: ${goal.title}${criteria ? `\n${criteria}` : ''}`
      }

      case 'recent_events': {
        const events = await this.v1Bridge.getRecentEvents(req.projectId, 10)
        return events
          .map((e) => `[${new Date(e.ts).toISOString().slice(0, 16)}] ${e.type}: ${String(e.content).slice(0, 120)}`)
          .join('\n')
      }

      case 'planning': {
        const state = await this.v1Bridge.getProjectState(req.projectId)
        if (!state) return ''
        const ms = Array.isArray(state.milestones) ? state.milestones : []
        const ns = Array.isArray(state.nextSteps) ? state.nextSteps : []
        const renderMilestone = (m: unknown): string => {
          const status = m && typeof m === 'object' ? (m as Record<string, unknown>).status : undefined
          return `- ${nodeLabel(m)}${status ? ` (${String(status)})` : ''}`
        }
        const parts = [
          ms.length ? `Milestones:\n${ms.map(renderMilestone).join('\n')}` : '',
          ns.length ? `Next steps:\n${ns.map((n) => `- ${nodeLabel(n)}`).join('\n')}` : '',
        ].filter(Boolean)
        return parts.join('\n\n')
      }

      case 'blockers': {
        const state = await this.v1Bridge.getProjectState(req.projectId)
        if (!state) return ''
        const bl = Array.isArray(state.blockers) ? state.blockers : []
        return bl.length ? bl.map((b) => `- ${nodeLabel(b)}`).join('\n') : 'No active blockers.'
      }

      case 'memory_relevant': {
        if (!req.query) return ''
        const results = await this.memory.search({
          query:     req.query,
          projectId: req.projectId,
          limit:     5,
          mode:      (req.mode as WorkMode | undefined),
        })
        return results.results
          .map((r) => r.content.slice(0, 400))
          .join('\n---\n')
      }

      case 'knowledge_graph': {
        const nodes = await this.knowledge.listNodes(req.projectId)
        if (!nodes.length) return ''

        let filtered = nodes
        if (req.query) {
          const words = req.query.toLowerCase().split(/\s+/).filter((w) => w.length > 3)
          const matched = nodes.filter((n) =>
            words.some(
              (w) => n.label.toLowerCase().includes(w) || (n.description?.toLowerCase().includes(w) ?? false),
            ),
          )
          filtered = matched.length ? matched : nodes
        }

        return filtered
          .sort((a, b) => b.confidence - a.confidence)
          .slice(0, 15)
          .map((n) => `[${n.type}] ${n.label}${n.description ? ` — ${n.description.slice(0, 120)}` : ''} (conf=${n.confidence.toFixed(2)})`)
          .join('\n')
      }

      case 'policy_constraints': {
        const rules = await this.policy.listRules(req.projectId)
        const enabled = rules.filter((r) => r.enabled)
        if (!enabled.length) return 'No active policy constraints.'
        // Project rule wins over system rule with same name (mirrors evaluate() logic)
        const ruleMap = new Map<string, typeof enabled[number]>()
        for (const rule of enabled) {
          const existing = ruleMap.get(rule.name)
          if (!existing || rule.projectId !== null) ruleMap.set(rule.name, rule)
        }
        return [...ruleMap.values()]
          .map((r) => `[${r.action.toUpperCase()}] ${r.name}: ${r.description}`)
          .join('\n')
      }

      case 'approval_gates': {
        const pending = await this.gates.findPending(req.projectId)
        if (!pending.length) return ''
        return pending
          .map((g) => `[${g.type.toUpperCase()}] ${g.description} (gate=${g.id.slice(0, 8)}, mission=${(g.missionId ?? 'n/a').slice(0, 8)})`)
          .join('\n')
      }

      default:
        return ''
    }
  }
}

// State JSON fields (milestones, nextSteps, successCriteria, blockers) may hold
// strings or objects ({id,title,status} / {id,text,done}). Extract a human label robustly.
function nodeLabel(item: unknown): string {
  if (typeof item === 'string') return item
  if (item && typeof item === 'object') {
    const o = item as Record<string, unknown>
    const label = o.title ?? o.description ?? o.text ?? o.name ?? o.label
    if (typeof label === 'string') return label
  }
  return ''
}

function sectionLabel(s: ContextSection): string {
  const labels: Record<ContextSection, string> = {
    project_state:      'Project State',
    active_goal:        'Active Goal',
    recent_events:      'Recent Activity',
    memory_relevant:    'Relevant Knowledge',
    planning:           'Planning',
    blockers:           'Blockers',
    knowledge_graph:    'Knowledge Graph',
    policy_constraints: 'Policy Constraints',
    approval_gates:     'Pending Approval Gates',
  }
  return labels[s] ?? s
}
