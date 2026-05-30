import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common'
import { V1ApiService } from '../core/v1-api.service'
import { ApprovalGatesService } from '../approval-gates/approval-gates.service'
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

  constructor(
    private readonly v1Api:  V1ApiService,
    private readonly gates:  ApprovalGatesService,
  ) {}

  async run(req: SkillRunRequest): Promise<SkillRunResult> {
    const skill = this.registry.get(req.skillId)
    if (!skill) throw new NotFoundException(`Skill '${req.skillId}' not found`)

    const t0 = Date.now()
    const logs: string[] = []

    // Create approval gate for medium/high risk skills (when in a mission context)
    if ((skill.risk === 'high' || skill.risk === 'medium') && !req.dryRun && req.missionId && req.stepId) {
      const { required, gate } = await this.gates.checkAndCreate(
        skill.risk,
        req.projectId ?? '',
        req.missionId,
        req.stepId,
        `Skill ${skill.name} requires approval (risk: ${skill.risk})`,
        { skillId: skill.id, input: req.input },
      )
      if (required && gate?.status === 'pending') {
        return {
          skillId:    req.skillId,
          success:    false,
          output:     { gateId: gate.id, status: 'pending_approval', message: `Awaiting approval — gate ${gate.id}` },
          durationMs: Date.now() - t0,
          logs:       [`Gate created: ${gate.id}`],
        }
      }
    }

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
