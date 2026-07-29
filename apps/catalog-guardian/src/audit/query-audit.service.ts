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

  // Fase 5 — exportação para steward/comitê. Sem limit (é uma exportação
  // completa do período, não uma página de histórico) e inclui as flags de
  // triagem já resolvidas ou não, pra dar visão completa num único arquivo.
  async exportRows(filters: { userId?: string; from?: Date; to?: Date } = {}) {
    return this.prisma.queryAudit.findMany({
      where: {
        userId: filters.userId,
        createdAt:
          filters.from || filters.to
            ? { gte: filters.from, lte: filters.to }
            : undefined,
      },
      include: { flags: true },
      orderBy: { createdAt: 'desc' },
    })
  }

  // Triagem humana (steward sinaliza resposta incorreta) — tabela separada
  // QueryAuditFlag, não um update no QueryAudit (ver comentário do model no
  // schema.prisma). O registro original nunca é tocado.
  async flag(queryAuditId: string, reason: string) {
    return this.prisma.queryAuditFlag.create({ data: { queryAuditId, reason } })
  }

  async resolveFlag(flagId: string) {
    return this.prisma.queryAuditFlag.update({
      where: { id: flagId },
      data: { resolvedAt: new Date() },
    })
  }
}
