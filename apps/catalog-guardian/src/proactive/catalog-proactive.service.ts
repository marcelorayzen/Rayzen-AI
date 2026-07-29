import { Injectable } from '@nestjs/common'
import { PrismaService } from '../core/prisma.service'

export interface Recommendation {
  id: string
  type: string
  title: string
  description: string
  priority: 'low' | 'medium' | 'high'
  action: string | null
  computedAt: string
}

// Mesma forma do ProactiveService do Rayzen V1 (apps/api/src/modules/proactive)
// — cache com TTL, compute() apaga as recomendações não descartadas e recria,
// dismiss() marca dismissedAt. Característica herdada do padrão V1, não
// "consertada" aqui: um dismiss() só suprime até o próximo compute() — se a
// condição ainda existir, a recomendação reaparece no ciclo seguinte.
const CACHE_TTL_MS = 30 * 60 * 1000 // 30min

const UNCLASSIFIED_MIN_DAYS = 7
const LOW_CONFIDENCE_WINDOW_DAYS = 30
const LOW_CONFIDENCE_MIN_QUERIES = 5
const LOW_CONFIDENCE_HIGH_RISK_RATIO = 0.4
const FLAGGED_UNRESOLVED_MIN_DAYS = 3

// permission_drift NÃO é computada aqui — é escrita diretamente pelo
// SyncService (ver sync.service.ts), no único momento em que "valor antigo
// vs valor novo" existe de verdade. Esta lista existe só pra excluir esse
// tipo do cleanup abaixo, sem apagar os eventos que o sync gravou.
const TYPES_OWNED_BY_SYNC = ['permission_drift']

@Injectable()
export class CatalogProactiveService {
  constructor(private readonly prisma: PrismaService) {}

  async getRecommendations(): Promise<Recommendation[]> {
    const latest = await this.prisma.catalogRecommendation.findFirst({
      where: { dismissedAt: null },
      orderBy: { computedAt: 'desc' },
    })
    const isStale = !latest || Date.now() - latest.computedAt.getTime() > CACHE_TTL_MS
    if (isStale) await this.compute()

    const rows = await this.prisma.catalogRecommendation.findMany({
      where: { dismissedAt: null },
    })

    const order = { high: 0, medium: 1, low: 2 }
    rows.sort((a, b) => (order[a.priority as keyof typeof order] ?? 2) - (order[b.priority as keyof typeof order] ?? 2))

    return rows.map((r) => ({
      id: r.id,
      type: r.type,
      title: r.title,
      description: r.description,
      priority: r.priority as 'low' | 'medium' | 'high',
      action: r.action,
      computedAt: r.computedAt.toISOString(),
    }))
  }

  async dismiss(id: string) {
    return this.prisma.catalogRecommendation.update({
      where: { id },
      data: { dismissedAt: new Date() },
    })
  }

  private async compute(): Promise<void> {
    const computedAt = new Date()

    await this.prisma.catalogRecommendation.deleteMany({
      where: { dismissedAt: null, type: { notIn: TYPES_OWNED_BY_SYNC } },
    })

    const assets = await this.prisma.catalogAsset.findMany()
    const newRecs: Array<{
      type: string
      title: string
      description: string
      priority: string
      action: string | null
      computedAt: Date
    }> = []

    // ── Regra: unclassified_asset ───────────────────────────────────────────
    const unclassifiedCutoff = new Date(Date.now() - UNCLASSIFIED_MIN_DAYS * 86400000)
    for (const asset of assets) {
      const tags = (asset.tags as string[] | null) ?? []
      if (tags.length === 0 && asset.firstSyncedAt < unclassifiedCutoff) {
        const days = Math.floor((Date.now() - asset.firstSyncedAt.getTime()) / 86400000)
        newRecs.push({
          type: 'unclassified_asset',
          title: `"${asset.name}" sem nenhuma classificação há ${days} dias`,
          description: 'Este ativo nunca recebeu tag/classificação no catálogo fonte desde que foi sincronizado pela primeira vez.',
          priority: 'high',
          action: 'Adicione ao menos uma tag/classificação a este ativo no catálogo fonte.',
          computedAt,
        })
      }
    }

    // ── Regra: orphan_owner ──────────────────────────────────────────────────
    for (const asset of assets) {
      if (!asset.owner) {
        newRecs.push({
          type: 'orphan_owner',
          title: `"${asset.name}" sem owner definido`,
          description: 'Nenhum responsável está atribuído a este ativo no catálogo fonte.',
          priority: 'medium',
          action: 'Defina um owner para este ativo no catálogo fonte.',
          computedAt,
        })
      }
    }

    // ── Regra: low_confidence_pattern ────────────────────────────────────────
    // Agregação em JS, não SQL — Prisma não faz GROUP BY portável sobre um
    // array dentro de um campo JSON (citedAssets). Dataset pequeno, sem custo
    // real de performance.
    const windowStart = new Date(Date.now() - LOW_CONFIDENCE_WINDOW_DAYS * 86400000)
    const recentAudits = await this.prisma.queryAudit.findMany({
      where: { createdAt: { gte: windowStart } },
    })
    const perAsset = new Map<string, { total: number; highRisk: number }>()
    for (const audit of recentAudits) {
      const cited = (audit.citedAssets as string[] | null) ?? []
      const isHighRisk = audit.riskLevel === 'high' || audit.riskLevel === 'critical'
      for (const externalId of cited) {
        const stats = perAsset.get(externalId) ?? { total: 0, highRisk: 0 }
        stats.total += 1
        if (isHighRisk) stats.highRisk += 1
        perAsset.set(externalId, stats)
      }
    }
    for (const [externalId, stats] of perAsset) {
      if (stats.total < LOW_CONFIDENCE_MIN_QUERIES) continue
      const ratio = stats.highRisk / stats.total
      if (ratio <= LOW_CONFIDENCE_HIGH_RISK_RATIO) continue
      const asset = assets.find((a) => a.externalId === externalId)
      newRecs.push({
        type: 'low_confidence_pattern',
        title: `Respostas sobre "${asset?.name ?? externalId}" com risco alto em ${Math.round(ratio * 100)}% das consultas`,
        description: `${stats.highRisk} de ${stats.total} consultas dos últimos ${LOW_CONFIDENCE_WINDOW_DAYS} dias sobre este ativo geraram risco alto/crítico.`,
        priority: 'high',
        action: 'Revise a descrição/documentação do ativo — perguntas sobre ele geram respostas de baixa confiança com frequência.',
        computedAt,
      })
    }

    // ── Regra: flagged_unresolved ────────────────────────────────────────────
    const flaggedCutoff = new Date(Date.now() - FLAGGED_UNRESOLVED_MIN_DAYS * 86400000)
    const unresolvedFlags = await this.prisma.queryAuditFlag.findMany({
      where: { resolvedAt: null, flaggedAt: { lte: flaggedCutoff } },
      include: { queryAudit: true },
    })
    for (const flag of unresolvedFlags) {
      const days = Math.floor((Date.now() - flag.flaggedAt.getTime()) / 86400000)
      newRecs.push({
        type: 'flagged_unresolved',
        title: `Resposta sinalizada como incorreta há ${days} dias sem ajuste`,
        description: `Pergunta: "${flag.queryAudit.question.slice(0, 80)}" — motivo: ${flag.reason}.`,
        priority: 'medium',
        action: 'Revise e corrija o ativo/resposta, depois marque a sinalização como resolvida.',
        computedAt,
      })
    }

    if (newRecs.length > 0) {
      await this.prisma.catalogRecommendation.createMany({ data: newRecs })
    } else {
      // "Tudo em ordem" só quando não há NENHUMA recomendação ativa — inclui
      // permission_drift, que este método não gerencia mas cujo estado ainda
      // deve impedir o placeholder de "tudo limpo".
      const anyActive = await this.prisma.catalogRecommendation.count({ where: { dismissedAt: null } })
      if (anyActive === 0) {
        await this.prisma.catalogRecommendation.create({
          data: {
            type: 'all_clear',
            title: 'Catálogo em ordem',
            description: 'Nenhuma inconsistência ou ação urgente identificada.',
            priority: 'low',
            action: null,
            computedAt,
          },
        })
      }
    }
  }
}
