import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../core/prisma.service'

// Padrão copiado do ApprovalGatesService (apps/api-v2/src/approval-gates/) —
// create/approve/reject/findPending/history já eram genéricos o suficiente
// pra reaproveitar quase verbatim. Reimplementado aqui (não importado direto)
// porque o Catalog Guardian precisa rodar isolado, sem depender do schema v2
// do Rayzen nem do EventsService/MissionService que o original usa.
export type ReviewGateType = 'high_risk_answer' | 'permission_ambiguous'
export type ReviewGateStatus = 'pending' | 'approved' | 'rejected' | 'expired'

export interface CreateReviewGateDto {
  type: ReviewGateType
  description: string
  context?: Record<string, unknown>
  createdBy?: string
}

@Injectable()
export class ReviewGateService {
  private readonly logger = new Logger(ReviewGateService.name)

  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateReviewGateDto) {
    const gate = await this.prisma.reviewGate.create({
      data: {
        type: dto.type,
        description: dto.description,
        context: (dto.context ?? {}) as object,
        status: 'pending',
        createdBy: dto.createdBy ?? null,
      },
    })
    this.logger.log(`Review gate criado: ${gate.id} (${dto.type})`)
    return gate
  }

  async findPending() {
    return this.prisma.reviewGate.findMany({
      where: { status: 'pending' },
      orderBy: { createdAt: 'asc' },
    })
  }

  async findOne(id: string) {
    const gate = await this.prisma.reviewGate.findUnique({ where: { id } })
    if (!gate) throw new NotFoundException(`ReviewGate ${id} não encontrado`)
    return gate
  }

  async approve(id: string, decidedBy: string, comment?: string) {
    // updateMany condicional — evita corrida entre dois stewards aprovando o mesmo gate
    const result = await this.prisma.reviewGate.updateMany({
      where: { id, status: 'pending' },
      data: { status: 'approved', decidedBy, decidedAt: new Date(), comment },
    })
    if (result.count === 0) {
      const gate = await this.findOne(id)
      throw new BadRequestException(`Gate já está ${gate.status}`)
    }
    return this.findOne(id)
  }

  async reject(id: string, decidedBy: string, comment?: string) {
    const result = await this.prisma.reviewGate.updateMany({
      where: { id, status: 'pending' },
      data: { status: 'rejected', decidedBy, decidedAt: new Date(), comment },
    })
    if (result.count === 0) {
      const gate = await this.findOne(id)
      throw new BadRequestException(`Gate já está ${gate.status}`)
    }
    return this.findOne(id)
  }

  async history(limit = 50) {
    return this.prisma.reviewGate.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
    })
  }
}
