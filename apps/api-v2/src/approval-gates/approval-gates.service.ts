import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common'
import { PrismaV2Service } from '../core/prisma-v2.service'
import { EventsService } from '../gateway/events.service'
import { MissionService } from '../mission/mission.service'

export type ApprovalGateType = 'code_deploy' | 'data_write' | 'external_api' | 'irreversible' | 'high_cost' | 'specialist_spawn' | 'clarification' | 'strategy_promotion' | 'guardian_review'
export type ApprovalStatus   = 'pending' | 'approved' | 'rejected' | 'expired'
export type GuardianRiskLevel = 'low' | 'medium' | 'high' | 'critical'

// Skills de risco médio expiram em 30min; alto risco não expiram automaticamente
const TTL: Record<string, number> = {
  medium: 30 * 60 * 1000,   // 30 min
  high:   7  * 24 * 60 * 60 * 1000, // 7 dias — obrigatório manual
}

export interface CreateGateDto {
  projectId:    string
  missionId?:   string   // optional — policy-triggered gates have no mission context
  stepId?:      string   // optional — policy-triggered gates have no step context
  type:         ApprovalGateType
  description:  string
  context?:     Record<string, unknown>
  riskLevel?:   'medium' | 'high'
  autoOnExpiry?: 'reject' | 'approve' | 'pause'
}

@Injectable()
export class ApprovalGatesService {
  private readonly logger = new Logger(ApprovalGatesService.name)

  constructor(
    private readonly prisma: PrismaV2Service,
    private readonly events: EventsService,
    private readonly missions: MissionService,
  ) {}

  async create(dto: CreateGateDto) {
    if (!dto.projectId?.trim()) {
      throw new BadRequestException('ApprovalGate.create: projectId é obrigatório')
    }
    const ttl = TTL[dto.riskLevel ?? 'high']
    return this.prisma.approvalGate.create({
      data: {
        projectId:    dto.projectId,
        missionId:    dto.missionId ?? null,
        stepId:       dto.stepId    ?? null,
        type:         dto.type,
        description:  dto.description,
        context:      (dto.context ?? {}) as object,
        status:       'pending',
        expiresAt:    new Date(Date.now() + ttl),
        autoOnExpiry: dto.autoOnExpiry ?? (dto.riskLevel === 'medium' ? 'reject' : 'pause'),
      },
    })
  }

  async findPending(projectId?: string, missionId?: string) {
    await this.expireStale()
    return this.prisma.approvalGate.findMany({
      where: {
        status: 'pending',
        ...(projectId ? { projectId } : {}),
        ...(missionId ? { missionId } : {}),
      },
      orderBy: { createdAt: 'asc' },
    })
  }

  async findOne(id: string) {
    const gate = await this.prisma.approvalGate.findUnique({ where: { id } })
    if (!gate) throw new NotFoundException(`ApprovalGate ${id} not found`)
    return gate
  }

  async approve(id: string, approvedBy: string, comment?: string) {
    // Atualização condicional atômica: elimina corrida entre dois aprovadores simultâneos
    const result = await this.prisma.approvalGate.updateMany({
      where: { id, status: 'pending' },
      data: { status: 'approved', approvedBy, approvedAt: new Date(), comment },
    })
    if (result.count === 0) {
      const gate = await this.findOne(id)
      throw new BadRequestException(`Gate is already ${gate.status}`)
    }
    return this.findOne(id)
  }

  async reject(id: string, approvedBy: string, comment?: string) {
    // Atualização condicional atômica: elimina corrida entre dois aprovadores simultâneos
    const result = await this.prisma.approvalGate.updateMany({
      where: { id, status: 'pending' },
      data: { status: 'rejected', approvedBy, approvedAt: new Date(), comment },
    })
    if (result.count === 0) {
      const gate = await this.findOne(id)
      throw new BadRequestException(`Gate is already ${gate.status}`)
    }
    return this.findOne(id)
  }

  async history(projectId: string, limit = 50) {
    return this.prisma.approvalGate.findMany({
      where:   { projectId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    })
  }

  async createClarificationGate(opts: {
    projectId: string
    missionId: string
    stepId:    string
    question:  string
    taskSummary: string
  }) {
    const gate = await this.create({
      projectId:   opts.projectId,
      missionId:   opts.missionId,
      stepId:      opts.stepId,
      type:        'clarification',
      description: opts.question,
      context:     { question: opts.question, taskSummary: opts.taskSummary },
      riskLevel:   'medium',
      autoOnExpiry: 'reject',
    })
    this.events.clarificationNeeded(opts.projectId, {
      id: gate.id, missionId: opts.missionId, stepId: opts.stepId, question: opts.question,
    })
    this.logger.log(`Clarification gate criado para step ${opts.stepId}: "${opts.question.slice(0, 80)}"`)
    return gate
  }

  // Called by RouterService / SkillEngine / PolicyEngine before high-risk operations
  async checkAndCreate(
    skillRisk: 'none' | 'low' | 'medium' | 'high',
    projectId: string, missionId: string | null, stepId: string | null,
    description: string, context: Record<string, unknown>,
  ): Promise<{ required: boolean; gate?: ReturnType<ApprovalGatesService['create']> extends Promise<infer T> ? T : never }> {
    if (skillRisk === 'none' || skillRisk === 'low') return { required: false }

    // Sem isso, toda aprovação só deixava a missão tentar de novo — a nova tentativa
    // (specialist reiniciado do zero) caía de novo aqui e criava OUTRO gate pending,
    // nunca deixando a ação de risco medium/high de fato executar. Reaproveita um
    // gate já aprovado pro mesmo step+skill em vez de pedir aprovação outra vez.
    const skillId = context['skillId'] as string | undefined
    if (stepId && skillId) {
      const approved = await this.prisma.approvalGate.findFirst({
        where: { stepId, status: 'approved', context: { path: ['skillId'], equals: skillId } },
        orderBy: { approvedAt: 'desc' },
      })
      if (approved) {
        this.logger.log(`Gate já aprovado reaproveitado para step ${stepId} / skill ${skillId} (gate ${approved.id})`)
        return { required: false }
      }
    }

    const type: ApprovalGateType = skillRisk === 'high' ? 'irreversible' : 'data_write'
    const gate = await this.create({
      projectId,
      missionId: missionId ?? undefined,
      stepId:    stepId    ?? undefined,
      type, description, context,
      riskLevel:    skillRisk,
      autoOnExpiry: skillRisk === 'medium' ? 'reject' : 'pause',
    })
    this.logger.log(`Gate created for ${description} — risk=${skillRisk} id=${gate.id}`)
    if (gate.missionId) {
      this.events.approvalGate(gate.projectId, {
        id: gate.id, missionId: gate.missionId, description: gate.description, type: gate.type,
      })
    }
    return { required: true, gate }
  }

  // Review Gate do Guardian — score determinístico do RiskScorerService vira gate aqui.
  // low (0-29) não bloqueia nada · medium (30-59) e high (60-84) abrem gate pendente
  // de revisão · critical (85+) é bloqueado na hora (gate criado e já rejeitado),
  // exigindo override explícito em vez de espera de aprovação.
  async createFromGuardianReport(opts: {
    projectId: string
    reportId:  string
    riskLevel: GuardianRiskLevel
    score:     number
    summary:   string
  }): Promise<{ required: boolean; gate?: Awaited<ReturnType<ApprovalGatesService['create']>> }> {
    if (opts.riskLevel === 'low') return { required: false }

    const gate = await this.create({
      projectId:   opts.projectId,
      type:        opts.riskLevel === 'critical' ? 'irreversible' : 'guardian_review',
      description: `Guardian ${opts.riskLevel.toUpperCase()} (${opts.score}) — ${opts.summary}`,
      context:     { guardianReportId: opts.reportId, riskLevel: opts.riskLevel, score: opts.score },
      riskLevel:   opts.riskLevel === 'medium' ? 'medium' : 'high',
      autoOnExpiry: opts.riskLevel === 'medium' ? 'reject' : 'pause',
    })

    if (opts.riskLevel === 'critical') {
      const rejected = await this.reject(gate.id, 'guardian-system', `Auto-bloqueado: risk score ${opts.score} >= 85`)
      return { required: true, gate: rejected }
    }

    return { required: true, gate }
  }

  private async expireStale() {
    const expired = await this.prisma.approvalGate.findMany({
      where: { status: 'pending', expiresAt: { lt: new Date() } },
    })
    if (expired.length === 0) return

    for (const g of expired) {
      const autoApprove = g.autoOnExpiry === 'approve'
      const newStatus = autoApprove ? 'approved' : 'expired'

      await this.prisma.approvalGate.update({
        where: { id: g.id },
        data:  { status: newStatus, approvedBy: 'system', approvedAt: new Date(), comment: 'Auto-expired' },
      })

      // Propaga estado para step e mission — expiração não é silenciosa
      if (g.missionId && g.stepId) {
        if (autoApprove) {
          await this.missions.updateStep(g.missionId, g.stepId, { status: 'pending' }).catch(() => null)
        } else {
          await this.missions.updateStep(g.missionId, g.stepId, {
            status: 'failed',
            output: { expired: true, autoOnExpiry: g.autoOnExpiry, expiresAt: g.expiresAt },
          }).catch(() => null)
          await this.missions.transition(g.missionId, 'paused').catch(() => null)
        }
      }

      if (g.projectId) {
        this.events.approvalGate(g.projectId, {
          id: g.id, missionId: g.missionId ?? '', description: g.description, type: g.type,
        })
      }
    }
    this.logger.log(`Expired ${expired.length} approval gate(s)`)
  }
}
