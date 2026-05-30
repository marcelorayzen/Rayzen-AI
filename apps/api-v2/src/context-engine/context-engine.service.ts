import { Injectable, Logger } from '@nestjs/common'
import { V1BridgeService } from '../core/v1-bridge.service'
import { MemoryService } from '../memory/memory.service'

export type WorkMode = 'implementation' | 'debugging' | 'review' | 'architecture' | 'study'
export type ContextSection =
  | 'project_state' | 'active_goal' | 'recent_events'
  | 'memory_relevant' | 'planning' | 'blockers'

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

// Sections included per work mode
const MODE_SECTIONS: Record<WorkMode, ContextSection[]> = {
  implementation: ['project_state', 'planning', 'memory_relevant', 'recent_events'],
  debugging:      ['project_state', 'blockers', 'memory_relevant', 'recent_events'],
  review:         ['project_state', 'active_goal', 'memory_relevant', 'planning'],
  architecture:   ['project_state', 'active_goal', 'planning', 'blockers'],
  study:          ['project_state', 'memory_relevant', 'recent_events'],
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
    private readonly v1Bridge: V1BridgeService,
    private readonly memory: MemoryService,
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
        const criteria = goal.successCriteria
          ? (goal.successCriteria as Array<{ description: string; done: boolean }>)
              .map((c) => `- [${c.done ? 'x' : ' '}] ${c.description}`)
              .join('\n')
          : ''
        return `Goal: ${goal.title}\n${criteria}`
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
        const ms = (state.milestones as string[] | null) ?? []
        const ns = (state.nextSteps as string[] | null) ?? []
        const parts = [
          ms.length ? `Milestones:\n${ms.map((m) => `- ${m}`).join('\n')}` : '',
          ns.length ? `Next steps:\n${ns.map((n) => `- ${n}`).join('\n')}` : '',
        ].filter(Boolean)
        return parts.join('\n\n')
      }

      case 'blockers': {
        const state = await this.v1Bridge.getProjectState(req.projectId)
        if (!state) return ''
        const bl = (state.blockers as string[] | null) ?? []
        return bl.length ? bl.map((b) => `- ${b}`).join('\n') : 'No active blockers.'
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

      default:
        return ''
    }
  }
}

function sectionLabel(s: ContextSection): string {
  const labels: Record<ContextSection, string> = {
    project_state:   'Project State',
    active_goal:     'Active Goal',
    recent_events:   'Recent Activity',
    memory_relevant: 'Relevant Knowledge',
    planning:        'Planning',
    blockers:        'Blockers',
  }
  return labels[s] ?? s
}
