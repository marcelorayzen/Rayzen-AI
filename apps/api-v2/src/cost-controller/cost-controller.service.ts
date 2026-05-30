import { Injectable, Logger } from '@nestjs/common'
import { PrismaV2Service } from '../core/prisma-v2.service'

export interface RecordCostDto {
  projectId:  string
  missionId?: string
  stepId?:    string
  model:      string
  tokensIn:   number
  tokensOut:  number
  costUsd:    number
  module?:    string
}

export interface BudgetStatus {
  projectId:   string
  period:      'daily' | 'monthly'
  limit:       number
  consumed:    number
  remaining:   number
  percentUsed: number
  status:      'ok' | 'warning' | 'blocked'
}

@Injectable()
export class CostControllerService {
  private readonly logger = new Logger(CostControllerService.name)

  constructor(private readonly prisma: PrismaV2Service) {}

  async record(dto: RecordCostDto) {
    return this.prisma.costRecord.create({
      data: {
        projectId: dto.projectId,
        missionId: dto.missionId,
        stepId:    dto.stepId,
        model:     dto.model,
        tokensIn:  dto.tokensIn,
        tokensOut: dto.tokensOut,
        costUsd:   dto.costUsd,
        module:    dto.module ?? 'ai-router',
      },
    })
  }

  async canSpend(projectId: string, estimatedCost: number): Promise<{ allowed: boolean; reason?: string }> {
    const budget = await this.prisma.costBudget.findUnique({ where: { projectId } })
    if (!budget) return { allowed: true }

    const [daily, monthly] = await Promise.all([
      this.getConsumed(projectId, 'daily'),
      this.getConsumed(projectId, 'monthly'),
    ])

    if (budget.daily && (daily + estimatedCost) / budget.daily >= budget.blockAt) {
      return { allowed: false, reason: `Daily budget exceeded: $${daily.toFixed(4)}/$${budget.daily}` }
    }
    if (budget.monthly && (monthly + estimatedCost) / budget.monthly >= budget.blockAt) {
      return { allowed: false, reason: `Monthly budget exceeded: $${monthly.toFixed(4)}/$${budget.monthly}` }
    }

    if (budget.daily && (daily + estimatedCost) / budget.daily >= budget.alertAt) {
      this.logger.warn(`Budget alert for ${projectId}: ${((daily / budget.daily) * 100).toFixed(1)}% of daily budget used`)
    }

    return { allowed: true }
  }

  async getStatus(projectId: string): Promise<BudgetStatus[]> {
    const budget = await this.prisma.costBudget.findUnique({ where: { projectId } })
    const [daily, monthly] = await Promise.all([
      this.getConsumed(projectId, 'daily'),
      this.getConsumed(projectId, 'monthly'),
    ])

    const result: BudgetStatus[] = []

    if (budget?.daily) {
      const pct = daily / budget.daily
      result.push({
        projectId, period: 'daily', limit: budget.daily, consumed: daily,
        remaining: Math.max(0, budget.daily - daily),
        percentUsed: Math.round(pct * 100),
        status: pct >= budget.blockAt ? 'blocked' : pct >= budget.alertAt ? 'warning' : 'ok',
      })
    }
    if (budget?.monthly) {
      const pct = monthly / budget.monthly
      result.push({
        projectId, period: 'monthly', limit: budget.monthly, consumed: monthly,
        remaining: Math.max(0, budget.monthly - monthly),
        percentUsed: Math.round(pct * 100),
        status: pct >= budget.blockAt ? 'blocked' : pct >= budget.alertAt ? 'warning' : 'ok',
      })
    }

    return result
  }

  async setBudget(projectId: string, data: { daily?: number; monthly?: number; perMission?: number; alertAt?: number; blockAt?: number }) {
    return this.prisma.costBudget.upsert({
      where:  { projectId },
      create: { projectId, ...data },
      update: data,
    })
  }

  async getBreakdown(projectId: string, days = 30) {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    const records = await this.prisma.costRecord.findMany({
      where: { projectId, createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
    })

    const byModel:   Record<string, number> = {}
    const byMission: Record<string, number> = {}
    let   total = 0

    for (const r of records) {
      byModel[r.model]          = (byModel[r.model] ?? 0)                   + r.costUsd
      if (r.missionId) byMission[r.missionId] = (byMission[r.missionId] ?? 0) + r.costUsd
      total += r.costUsd
    }

    return { projectId, totalUsd: total, byModel, byMission, recordCount: records.length }
  }

  async estimate(model: string, estimatedTokens: number): Promise<number> {
    const COST_PER_1M: Record<string, number> = {
      'gpt-4o-mini':     0.10,
      'gpt-4o':          0.70,
      'gpt-4o-premium':  9.00,
    }
    const cpm = COST_PER_1M[model] ?? 0.70
    return (estimatedTokens / 1_000_000) * cpm
  }

  private async getConsumed(projectId: string, period: 'daily' | 'monthly'): Promise<number> {
    const since = period === 'daily'
      ? new Date(Date.now() - 24 * 60 * 60 * 1000)
      : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)

    const result = await this.prisma.costRecord.aggregate({
      where: { projectId, createdAt: { gte: since } },
      _sum:  { costUsd: true },
    })
    return result._sum.costUsd ?? 0
  }
}
