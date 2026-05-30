import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common'
import { PrismaV2Service } from '../core/prisma-v2.service'

export type ApprovalGateType = 'code_deploy' | 'data_write' | 'external_api' | 'irreversible' | 'high_cost' | 'specialist_spawn'
export type ApprovalStatus   = 'pending' | 'approved' | 'rejected' | 'expired'

// Skills de risco médio expiram em 30min; alto risco não expiram automaticamente
const TTL: Record<string, number> = {
  medium: 30 * 60 * 1000,   // 30 min
  high:   7  * 24 * 60 * 60 * 1000, // 7 dias — obrigatório manual
}

export interface CreateGateDto {
  projectId:    string
  missionId:    string
  stepId:       string
  type:         ApprovalGateType
  description:  string
  context?:     Record<string, unknown>
  riskLevel?:   'medium' | 'high'
  autoOnExpiry?: 'reject' | 'approve' | 'pause'
}

@Injectable()
export class ApprovalGatesService {
  private readonly logger = new Logger(ApprovalGatesService.name)

  constructor(private readonly prisma: PrismaV2Service) {}

  async create(dto: CreateGateDto) {
    const ttl = TTL[dto.riskLevel ?? 'high']
    return this.prisma.approvalGate.create({
      data: {
        projectId:    dto.projectId,
        missionId:    dto.missionId,
        stepId:       dto.stepId,
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
    const gate = await this.findOne(id)
    if (gate.status !== 'pending') {
      throw new BadRequestException(`Gate is already ${gate.status}`)
    }
    return this.prisma.approvalGate.update({
      where: { id },
      data: { status: 'approved', approvedBy, approvedAt: new Date(), comment },
    })
  }

  async reject(id: string, approvedBy: string, comment?: string) {
    const gate = await this.findOne(id)
    if (gate.status !== 'pending') {
      throw new BadRequestException(`Gate is already ${gate.status}`)
    }
    return this.prisma.approvalGate.update({
      where: { id },
      data: { status: 'rejected', approvedBy, approvedAt: new Date(), comment },
    })
  }

  async history(projectId: string, limit = 50) {
    return this.prisma.approvalGate.findMany({
      where:   { projectId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    })
  }

  // Called by SkillEngine before executing high-risk skills
  async checkAndCreate(
    skillRisk: 'none' | 'low' | 'medium' | 'high',
    projectId: string, missionId: string, stepId: string,
    description: string, context: Record<string, unknown>,
  ): Promise<{ required: boolean; gate?: ReturnType<ApprovalGatesService['create']> extends Promise<infer T> ? T : never }> {
    if (skillRisk === 'none' || skillRisk === 'low') return { required: false }

    const type: ApprovalGateType = skillRisk === 'high' ? 'irreversible' : 'data_write'
    const gate = await this.create({
      projectId, missionId, stepId, type, description, context,
      riskLevel:    skillRisk,
      autoOnExpiry: skillRisk === 'medium' ? 'reject' : 'pause',
    })
    this.logger.log(`Gate created for ${description} — risk=${skillRisk} id=${gate.id}`)
    return { required: true, gate }
  }

  private async expireStale() {
    const expired = await this.prisma.approvalGate.findMany({
      where: { status: 'pending', expiresAt: { lt: new Date() } },
    })
    if (expired.length === 0) return

    for (const g of expired) {
      const newStatus = g.autoOnExpiry === 'approve' ? 'approved' : 'expired'
      await this.prisma.approvalGate.update({
        where: { id: g.id },
        data:  { status: newStatus, approvedBy: 'system', approvedAt: new Date(), comment: 'Auto-expired' },
      })
    }
    if (expired.length > 0) {
      this.logger.log(`Expired ${expired.length} approval gates`)
    }
  }
}
