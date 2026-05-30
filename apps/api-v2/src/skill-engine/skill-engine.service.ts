import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common'
import { V1ApiService } from '../core/v1-api.service'
import { SkillRegistry } from './skill-registry'

export interface SkillRunRequest {
  skillId:    string
  input:      Record<string, unknown>
  projectId?: string
  missionId?: string
  stepId?:    string
  dryRun?:    boolean
}

export interface SkillRunResult {
  skillId:    string
  success:    boolean
  output:     Record<string, unknown>
  durationMs: number
  logs:       string[]
}

@Injectable()
export class SkillEngineService {
  private readonly logger = new Logger(SkillEngineService.name)
  readonly registry = new SkillRegistry()

  constructor(private readonly v1Api: V1ApiService) {}

  async run(req: SkillRunRequest): Promise<SkillRunResult> {
    const skill = this.registry.get(req.skillId)
    if (!skill) throw new NotFoundException(`Skill '${req.skillId}' not found`)

    if (skill.risk === 'high' && !req.dryRun) {
      throw new BadRequestException(
        `Skill '${req.skillId}' has risk=high. Set dryRun:true to preview, or confirm explicitly.`,
      )
    }

    const t0 = Date.now()
    const logs: string[] = []

    try {
      if (req.dryRun) {
        logs.push(`[dry-run] would execute ${skill.id} via ${skill.runtime}`)
        return {
          skillId:    req.skillId,
          success:    true,
          output:     { dryRun: true, skill: skill.id, runtime: skill.runtime, input: req.input },
          durationMs: Date.now() - t0,
          logs,
        }
      }

      // Dispatch to V1 agent via execution API
      const output = await this.dispatchToAgent(req, logs)
      return { skillId: req.skillId, success: true, output, durationMs: Date.now() - t0, logs }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      this.logger.error(`skill ${req.skillId} failed: ${msg}`)
      return {
        skillId:    req.skillId,
        success:    false,
        output:     { error: msg },
        durationMs: Date.now() - t0,
        logs:       [...logs, `ERROR: ${msg}`],
      }
    }
  }

  private async dispatchToAgent(req: SkillRunRequest, logs: string[]): Promise<Record<string, unknown>> {
    const skill = this.registry.get(req.skillId)!
    logs.push(`dispatching ${skill.id} to ${skill.runtime}`)

    const baseUrl = (process.env.V1_API_URL ?? 'http://api:3001').replace(/\/$/, '')
    const token   = process.env.V1_API_TOKEN ?? process.env.AGENT_TOKEN ?? ''

    const res = await fetch(`${baseUrl}/execution/dispatch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        module:    'jarvis',
        action:    req.skillId,
        payload:   req.input,
        projectId: req.projectId,
        role:      skill.runtime === 'agent-server' ? 'server' : 'desktop',
      }),
    })

    if (!res.ok) {
      throw new Error(`V1 dispatch failed: ${res.status}`)
    }

    return res.json() as Promise<Record<string, unknown>>
  }

  listSkills(category?: string) {
    return this.registry.list(category as Parameters<SkillRegistry['list']>[0])
  }

  getSkill(id: string) {
    const skill = this.registry.get(id)
    if (!skill) throw new NotFoundException(`Skill '${id}' not found`)
    return skill
  }

  getCategories() {
    return this.registry.categories()
  }
}
