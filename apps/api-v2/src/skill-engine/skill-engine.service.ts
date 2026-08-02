import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common'
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
      if (!req.projectId?.trim()) {
        throw new BadRequestException(`Skill '${req.skillId}' (risco ${skill.risk}) requer projectId para criar o gate de aprovação`)
      }
      const { required, gate } = await this.gates.checkAndCreate(
        skill.risk,
        req.projectId,
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

      const output = skill.runtime === 'in-process'
        ? await this.runInProcess(req, skill, logs)
        : await this.dispatchToAgent(req, skill, logs)
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

  /**
   * Skills 'in-process' rodam dentro da própria api-v2, sem round-trip pelo
   * agent desktop/server — reservado para operações que já são chamadas de
   * API internas, evitando latência e a dependência da whitelist do agent
   * para algo que não toca o filesystem local.
   */
  private async runInProcess(
    req: SkillRunRequest,
    skill: Awaited<ReturnType<SkillRegistryService['resolve']>>,
    logs: string[],
  ): Promise<Record<string, unknown>> {
    logs.push(`executing ${skill!.id} in-process`)

    switch (skill!.id) {
      default:
        throw new Error(`No in-process handler registered for skill '${skill!.id}'`)
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

    // ExecutionController/dispatch() em V1 já prefixa com 'jarvis:' (module + ':' + action) —
    // mandar req.skillId completo aqui duplicava o prefixo ("jarvis:jarvis:file_read"),
    // rejeitado pela whitelist do agente. action deve ser o nome SEM o prefixo "jarvis:".
    const res = await fetch(`${baseUrl}/execution/dispatch`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        action:    req.skillId.replace(/^jarvis:/, ''),
        payload:   req.input,
      }),
    })

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`V1 dispatch failed: HTTP ${res.status} — ${body.slice(0, 300)}`)
    }
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
