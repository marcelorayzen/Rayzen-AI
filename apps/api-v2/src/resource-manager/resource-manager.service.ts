import { Injectable, Logger } from '@nestjs/common'

export interface ResourceLimits {
  projectId:                  string
  maxTokensPerStep:           number
  maxTokensPerMission:        number
  maxActiveAgents:            number
  agentTtlMinutes:            number
  maxStepRetries:             number
  maxMissionDurationMinutes:  number
  maxMemoryChunks:            number
}

const DEFAULT_LIMITS: Omit<ResourceLimits, 'projectId'> = {
  maxTokensPerStep:          8_000,
  maxTokensPerMission:       100_000,
  maxActiveAgents:           3,
  agentTtlMinutes:           30,
  maxStepRetries:            3,
  maxMissionDurationMinutes: 120,
  maxMemoryChunks:           10_000,
}

interface AgentEntry { agentId: string; missionId: string; startedAt: Date; tokensUsed: number }
interface MissionTokens { [missionId: string]: number }

@Injectable()
export class ResourceManagerService {
  private readonly logger = new Logger(ResourceManagerService.name)
  private readonly projectLimits = new Map<string, ResourceLimits>()
  private readonly activeAgents  = new Map<string, AgentEntry>()
  private readonly missionTokens: MissionTokens = {}

  getLimits(projectId: string): ResourceLimits {
    return this.projectLimits.get(projectId) ?? { ...DEFAULT_LIMITS, projectId }
  }

  setLimits(projectId: string, patch: Partial<Omit<ResourceLimits, 'projectId'>>) {
    const current = this.getLimits(projectId)
    const updated = { ...current, ...patch }
    this.projectLimits.set(projectId, updated)
    return updated
  }

  // Check if a new AI call is within budget
  checkContextBudget(projectId: string, missionId: string, estimatedTokens: number): { ok: boolean; reason?: string } {
    const limits    = this.getLimits(projectId)
    const mUsed     = this.missionTokens[missionId] ?? 0

    if (estimatedTokens > limits.maxTokensPerStep) {
      return { ok: false, reason: `Step context ${estimatedTokens} > limit ${limits.maxTokensPerStep}` }
    }
    if (mUsed + estimatedTokens > limits.maxTokensPerMission) {
      return { ok: false, reason: `Mission tokens ${mUsed + estimatedTokens} > limit ${limits.maxTokensPerMission}` }
    }
    return { ok: true }
  }

  // Record tokens used by a mission
  recordTokens(missionId: string, tokens: number) {
    this.missionTokens[missionId] = (this.missionTokens[missionId] ?? 0) + tokens
  }

  // Check if step retries exceed limit
  checkRetries(projectId: string, retries: number): { ok: boolean; requiresGate: boolean } {
    const limits = this.getLimits(projectId)
    if (retries >= limits.maxStepRetries) {
      return { ok: false, requiresGate: true }
    }
    return { ok: true, requiresGate: false }
  }

  // Agent lifecycle management
  registerAgent(agentId: string, missionId: string) {
    this.activeAgents.set(agentId, { agentId, missionId, startedAt: new Date(), tokensUsed: 0 })
    this.logger.debug(`Agent ${agentId} registered for mission ${missionId}`)
  }

  destroyAgent(agentId: string) {
    this.activeAgents.delete(agentId)
    this.logger.debug(`Agent ${agentId} destroyed`)
  }

  // Sweep zombie agents (called periodically)
  sweepZombies(projectId: string) {
    const limits  = this.getLimits(projectId)
    const ttlMs   = limits.agentTtlMinutes * 60 * 1000
    const cutoff  = Date.now() - ttlMs
    const zombies: string[] = []

    for (const [id, agent] of this.activeAgents) {
      if (agent.startedAt.getTime() < cutoff) {
        zombies.push(id)
        this.activeAgents.delete(id)
      }
    }

    if (zombies.length > 0) {
      this.logger.warn(`Swept ${zombies.length} zombie agents: ${zombies.join(', ')}`)
    }
    return zombies
  }

  getStatus(projectId: string) {
    const limits   = this.getLimits(projectId)
    const agents   = [...this.activeAgents.values()]
    const ttlMs    = limits.agentTtlMinutes * 60 * 1000
    const now      = Date.now()

    const agentInfos = agents.map((a) => ({
      ...a,
      idleSinceMs: now - a.startedAt.getTime(),
      status: (now - a.startedAt.getTime()) > ttlMs ? 'zombie' : 'active',
    }))

    return {
      projectId,
      limits,
      activeAgents:    agentInfos.length,
      zombieAgents:    agentInfos.filter((a) => a.status === 'zombie').length,
      missionContexts: Object.entries(this.missionTokens).map(([id, tokens]) => ({
        missionId: id,
        tokensUsed: tokens,
        budget: limits.maxTokensPerMission,
        percentUsed: Math.round((tokens / limits.maxTokensPerMission) * 100),
      })),
    }
  }
}
