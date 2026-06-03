import { Injectable, Logger, NotFoundException } from '@nestjs/common'
import { ApprovalGatesService } from '../approval-gates/approval-gates.service'
import { SkillRegistryService } from './skill-registry.service'

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

  constructor(
    private readonly gates:    ApprovalGatesService,
    private readonly registry: SkillRegistryService,
  ) {}

  async run(req: SkillRunRequest): Promise<SkillRunResult> {
    const skill = await this.registry.resolve(req.skillId)
    if (!skill) throw new NotFoundException(`Skill '${req.skillId}' not found or disabled`)

    const t0   = Date.now()
    const logs: string[] = []

    // Approval gate para skills de risco medium/high em contexto de missão
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
        const result: SkillRunResult = {
          skillId:    req.skillId,
          success:    false,
          output:     { gateId: gate.id, status: 'pending_approval', message: `Awaiting approval — gate ${gate.id}` },
          durationMs: Date.now() - t0,
          logs:       [`Gate created: ${gate.id}`],
        }
        await this.registry.logUsage({ skillId: req.skillId, projectId: req.projectId, missionId: req.missionId, stepId: req.stepId, success: false, durationMs: result.durationMs })
        return result
      }
    }

    try {
      if (req.dryRun) {
        logs.push(`[dry-run] would execute ${skill.id} via ${skill.runtime}`)
        const result: SkillRunResult = {
          skillId:    req.skillId,
          success:    true,
          output:     { dryRun: true, skill: skill.id, runtime: skill.runtime, input: req.input },
          durationMs: Date.now() - t0,
          logs,
        }
        await this.registry.logUsage({ skillId: req.skillId, projectId: req.projectId, missionId: req.missionId, stepId: req.stepId, success: true, durationMs: result.durationMs })
        return result
      }

      const output = await this.dispatchToAgent(req, skill, logs)
      const durationMs = Date.now() - t0
      await this.registry.logUsage({ skillId: req.skillId, projectId: req.projectId, missionId: req.missionId, stepId: req.stepId, success: true, durationMs })
      return { skillId: req.skillId, success: true, output, durationMs, logs }
    } catch (e) {
      const msg        = e instanceof Error ? e.message : String(e)
      const durationMs = Date.now() - t0
      this.logger.error(`skill ${req.skillId} failed: ${msg}`)
      await this.registry.logUsage({ skillId: req.skillId, projectId: req.projectId, missionId: req.missionId, stepId: req.stepId, success: false, durationMs, error: msg })
      return {
        skillId:    req.skillId,
        success:    false,
        output:     { error: msg },
        durationMs,
        logs: [...logs, `ERROR: ${msg}`],
      }
    }
  }

  private async dispatchToAgent(
    req: SkillRunRequest,
    skill: Awaited<ReturnType<SkillRegistryService['resolve']>>,
    logs: string[],
  ): Promise<Record<string, unknown>> {
    logs.push(`dispatching ${skill!.id} to ${skill!.runtime}`)

    const baseUrl = (process.env.V1_API_URL ?? 'http://api:3001').replace(/\/$/, '')
    const token   = process.env.V1_API_TOKEN ?? process.env.AGENT_TOKEN ?? ''

    const res = await fetch(`${baseUrl}/execution/dispatch`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        module:    'jarvis',
        action:    req.skillId,
        payload:   req.input,
        projectId: req.projectId,
        role:      skill!.runtime === 'agent-server' ? 'server' : 'desktop',
      }),
    })

    if (!res.ok) throw new Error(`V1 dispatch failed: ${res.status}`)
    return res.json() as Promise<Record<string, unknown>>
  }

  async listSkills(category?: string) {
    return this.registry.listAll(category)
  }

  async getSkill(id: string) {
    const skill = await this.registry.resolve(id)
    if (!skill) throw new NotFoundException(`Skill '${id}' not found or disabled`)
    return skill
  }

  async getCategories() {
    return this.registry.categories()
  }
}
