import { Injectable } from '@nestjs/common'
import { PrismaService } from '../core/prisma.service'

export interface RecordQueryAuditDto {
  userId: string
  profile: string
  question: string
  answer: string
  restrictedFieldsOmitted: string[]
  citedAssets: string[]
  riskScore: number
  riskLevel: string
  gateRequired: boolean
  gateId?: string | null
}

// Append-only por design — nenhum método de update/delete é exposto.
// Toda pergunta/resposta/decisão do Catalog Guardian passa por aqui antes
// de ser considerada "processada" (Fase 5 exporta isto em CSV/PDF).
@Injectable()
export class QueryAuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(dto: RecordQueryAuditDto) {
    return this.prisma.queryAudit.create({
      data: {
        userId: dto.userId,
        profile: dto.profile,
        question: dto.question,
        answer: dto.answer,
        restrictedFieldsOmitted: dto.restrictedFieldsOmitted,
        citedAssets: dto.citedAssets,
        riskScore: dto.riskScore,
        riskLevel: dto.riskLevel,
        gateRequired: dto.gateRequired,
        gateId: dto.gateId ?? null,
      },
    })
  }

  async history(userId?: string, limit = 50) {
    return this.prisma.queryAudit.findMany({
      where: userId ? { userId } : undefined,
      orderBy: { createdAt: 'desc' },
      take: limit,
    })
  }
}
