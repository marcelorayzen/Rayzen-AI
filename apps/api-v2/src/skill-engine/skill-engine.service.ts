import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common'
import { ApprovalGatesService } from '../approval-gates/approval-gates.service'
import { SkillRegistryService } from './skill-registry.service'
import { GuardianService } from '../guardian/guardian.service'

export interface SkillRunRequest {
  skillId:    string
  input:      Record<string, unknown>
  projectId?: string
  missionId?: string
  stepId?:    string
  dryRun?:    boolean
}

/**
 * ── As skills que SÃO o ato de aprovar não podem ser gated por aprovação ─────
 *
 * Achado ao fechar o A08: com o gate dependendo só do risco, `guardian:approve_review` (medium)
 * passou a exigir uma aprovação para aprovar, e `guardian:reject_review` uma aprovação para
 * rejeitar. Isso é regressão infinita, não segurança — e `guardian:override`, que existe
 * justamente para uma pessoa levantar um bloqueio do Guardian, cai no mesmo laço.
 *
 * O gate existe para **interpor uma pessoa entre um agente autônomo e uma ação consequente**.
 * Estas três não são a ação consequente: são a pessoa se interpondo. O que as autoriza é a
 * identidade autenticada de quem chama, que o `JwtAuthGuard` já exige.
 *
 * A isenção é por **id literal**, curta e auditável — não por categoria nem por runtime. Baixar
 * o `risk` delas no registro seria mais fácil e pior: o rótulo de risco também alimenta catálogo,
 * log de uso e a matriz de `docs/agent-actions.md`, e passaria a mentir sobre a consequência
 * para resolver um problema de mecanismo.
 */
const SKILLS_QUE_SAO_O_PROPRIO_ATO_DE_APROVAR = new Set([
  'guardian:approve_review',
  'guardian:reject_review',
  'guardian:override',
])

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
    private readonly guardian: GuardianService,
  ) {}

  async run(req: SkillRunRequest): Promise<SkillRunResult> {
    const skill = await this.registry.resolve(req.skillId)
    if (!skill) throw new NotFoundException(`Skill '${req.skillId}' not found or disabled`)

    const t0   = Date.now()
    const logs: string[] = []

    // ── A08: o gate depende do RISCO, não da porta por onde o pedido entrou ────
    //
    // A condição era `... && req.missionId && req.stepId`, e `missionId` é um campo que o
    // CHAMADOR preenche. Dois dos quatro chamadores nunca preenchem: `POST /v2/skills/run` (o
    // DTO marca os dois como opcionais) e `RouterService.executeSkill`, que é o caminho
    // conversacional da V2. Por eles, `jarvis:file_delete`, `jarvis:send_email`,
    // `jarvis:prisma_migrate` e `guardian:override` — as quatro `high` — executavam **sem gate
    // nenhum**, enquanto a mesma skill pedida por dentro de uma missão parava para aprovação.
    //
    // Autorização que muda conforme a entrada não é autorização, é coincidência de rota. Era o
    // A08 da auditoria de 13/09: *"aprovação e IDs não têm contrato uniforme; acesso direto sem
    // missão contorna gate de skill"*.
    //
    // A engrenagem já suportava: `missionId`/`stepId` são nuláveis no schema **e** na assinatura
    // de `checkAndCreate` desde sempre. O que faltava era deixar de exigi-los.
    //
    // Nada em uso ativo é afetado — medido em produção em 15/09: nenhuma skill medium/high foi
    // executada desde `jarvis:file_write` em 25/06, e o endpoint não tem chamador na web nem no
    // widget. `dryRun` continua passando direto, que é o ponto dele.
    const exigeGate = (skill.risk === 'high' || skill.risk === 'medium')
      && !SKILLS_QUE_SAO_O_PROPRIO_ATO_DE_APROVAR.has(skill.id)

    if (exigeGate && !req.dryRun) {
      if (!req.projectId?.trim()) {
        throw new BadRequestException(`Skill '${req.skillId}' (risco ${skill.risk}) requer projectId para criar o gate de aprovação`)
      }
      const { required, gate } = await this.gates.checkAndCreate(
        skill.risk,
        req.projectId,
        req.missionId ?? null,
        req.stepId ?? null,
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
   * agent desktop/server — usadas para operações que já são chamadas de API
   * internas (ex: consultas/ações do Guardian), evitando latência e a
   * dependência da whitelist do agent para algo que não toca o filesystem local.
   */
  private async runInProcess(
    req: SkillRunRequest,
    skill: Awaited<ReturnType<SkillRegistryService['resolve']>>,
    logs: string[],
  ): Promise<Record<string, unknown>> {
    logs.push(`executing ${skill!.id} in-process`)
    const input = req.input as Record<string, unknown>

    switch (skill!.id) {
      case 'guardian:status': {
        const report = await this.guardian.getLatest(String(input.projectId ?? req.projectId ?? ''))
        return { report }
      }
      case 'guardian:history': {
        const reports = await this.guardian.getHistory(String(input.projectId ?? req.projectId ?? ''))
        return { reports }
      }
      case 'guardian:override': {
        const report = await this.guardian.override(String(input.reportId), String(input.reason))
        return { report }
      }
      case 'guardian:review_gates': {
        const projectId = String(input.projectId ?? req.projectId ?? '')
        const pending    = await this.gates.findPending(projectId)
        return { gates: pending.filter((g) => g.type === 'guardian_review') }
      }
      case 'guardian:approve_review': {
        const gate = await this.gates.approve(String(input.gateId), String(input.approvedBy ?? 'unknown'), input.comment as string | undefined)
        return { gate }
      }
      case 'guardian:reject_review': {
        const gate = await this.gates.reject(String(input.gateId), String(input.approvedBy ?? 'unknown'), input.comment as string | undefined)
        return { gate }
      }
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
