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
// — cache com TTL, compute() recalcula, dismiss() marca dismissedAt.
//
// Backlog "dismiss() não-sticky" (fechado): até esta revisão, compute()
// apagava TODAS as recomendações ativas e recriava do zero a cada ciclo —
// um dismiss() só suprimia até o próximo compute() (30min), porque a nova
// linha criada tinha um id novo, nunca dismissado. Corrigido com dedupeKey
// (chave estável por tipo+alvo, ex. "orphan_owner:svc.db.schema.clientes")
// e upsert em vez de delete+create — ver compute() abaixo.
const CACHE_TTL_MS = 30 * 60 * 1000 // 30min

const UNCLASSIFIED_MIN_DAYS = 7
const LOW_CONFIDENCE_WINDOW_DAYS = 30
const LOW_CONFIDENCE_MIN_QUERIES = 5
const LOW_CONFIDENCE_HIGH_RISK_RATIO = 0.4
const FLAGGED_UNRESOLVED_MIN_DAYS = 3

// Tipos que ESTE serviço computa e, por isso, tem permissão de apagar e
// recriar a cada ciclo. permission_drift NÃO está aqui de propósito — é
// escrita diretamente pelo SyncService (ver sync.service.ts), no único
// momento em que "valor antigo vs valor novo" existe de verdade.
//
// Item 7 (revisão pós-Fase 6): isto era um blocklist (`notIn`) até esta
// revisão — apagava tudo que NÃO estivesse numa lista de "tipos donos de
// outro serviço". Perigoso por construção: se um novo tipo escrito por
// outro serviço aparecesse no futuro e alguém esquecesse de adicioná-lo à
// exclusão, o próximo `compute()` apagaria silenciosamente esses registros.
// Allowlist (`in`) inverte o risco — este serviço só mexe nos tipos que ele
// mesmo reconhece como seus; qualquer tipo novo de outra origem fica
// protegido por padrão, sem precisar de nenhuma mudança aqui.
const TYPES_COMPUTED_HERE = ['unclassified_asset', 'orphan_owner', 'low_confidence_pattern', 'flagged_unresolved', 'all_clear']

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

    // Linhas de sessões antes do dedupeKey existir nunca vão bater em nenhum
    // upsert por chave — limpa esse lixo órfão uma vez, incondicional (não é
    // uma condição real que ainda vale, é resíduo de schema antigo).
    await this.prisma.catalogRecommendation.deleteMany({
      where: { type: { in: TYPES_COMPUTED_HERE }, dedupeKey: null },
    })

    const assets = await this.prisma.catalogAsset.findMany()
    const candidates: Array<{
      dedupeKey: string
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
        candidates.push({
          dedupeKey: `unclassified_asset:${asset.externalId}`,
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
        candidates.push({
          dedupeKey: `orphan_owner:${asset.externalId}`,
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
      candidates.push({
        dedupeKey: `low_confidence_pattern:${externalId}`,
        type: 'low_confidence_pattern',
        title: `Respostas sobre "${asset?.name ?? externalId}" com risco alto em ${Math.round(ratio * 100)}% das consultas`,
        description: `${stats.highRisk} de ${stats.total} consultas dos últimos ${LOW_CONFIDENCE_WINDOW_DAYS} dias sobre este ativo geraram risco alto/crítico.`,
        priority: 'high',
        action: 'Revise a descrição/documentação do ativo — perguntas sobre ele geram respostas de baixa confiança com frequência.',
        computedAt,
      })
    }

    // ── Regra: flagged_unresolved ────────────────────────────────────────────
    // dedupeKey usa o id do próprio QueryAuditFlag — cada flag não resolvida
    // mapeia 1:1 pra uma recomendação (não o ativo, que pode ter várias flags).
    const flaggedCutoff = new Date(Date.now() - FLAGGED_UNRESOLVED_MIN_DAYS * 86400000)
    const unresolvedFlags = await this.prisma.queryAuditFlag.findMany({
      where: { resolvedAt: null, flaggedAt: { lte: flaggedCutoff } },
      include: { queryAudit: true },
    })
    for (const flag of unresolvedFlags) {
      const days = Math.floor((Date.now() - flag.flaggedAt.getTime()) / 86400000)
      candidates.push({
        dedupeKey: `flagged_unresolved:${flag.id}`,
        type: 'flagged_unresolved',
        title: `Resposta sinalizada como incorreta há ${days} dias sem ajuste`,
        description: `Pergunta: "${flag.queryAudit.question.slice(0, 80)}" — motivo: ${flag.reason}.`,
        priority: 'medium',
        action: 'Revise e corrija o ativo/resposta, depois marque a sinalização como resolvida.',
        computedAt,
      })
    }

    // Upsert por dedupeKey — se a recomendação já existia (mesmo tipo+alvo),
    // atualiza o conteúdo (título/descrição podem mudar, ex. contagem de
    // dias) SEM tocar em dismissedAt. É este update-sem-tocar-dismissedAt que
    // corrige o backlog: antes, delete+create de tudo a cada ciclo dava um id
    // novo pra cada recomendação, então nenhum dismiss() sobrevivia.
    for (const c of candidates) {
      await this.prisma.catalogRecommendation.upsert({
        where: { dedupeKey: c.dedupeKey },
        create: {
          dedupeKey: c.dedupeKey,
          type: c.type,
          title: c.title,
          description: c.description,
          priority: c.priority,
          action: c.action,
          computedAt: c.computedAt,
        },
        update: {
          title: c.title,
          description: c.description,
          priority: c.priority,
          action: c.action,
          computedAt: c.computedAt,
        },
      })
    }

    // Remove recomendações computadas cuja condição não bate mais neste ciclo
    // (ex. asset ganhou owner) — dismissada ou não, deixou de ser relevante.
    // Ramo explícito pro caso "nenhum candidato" em vez de confiar em notIn
    // com array vazio (semântica de NULL/vazio em NOT IN é sutil o bastante
    // pra não valer a pena arriscar).
    const currentKeys = candidates.map((c) => c.dedupeKey)
    const realTypes = TYPES_COMPUTED_HERE.filter((t) => t !== 'all_clear')
    if (currentKeys.length > 0) {
      await this.prisma.catalogRecommendation.deleteMany({
        where: { type: { in: realTypes }, dedupeKey: { notIn: currentKeys } },
      })
    } else {
      await this.prisma.catalogRecommendation.deleteMany({ where: { type: { in: realTypes } } })
    }

    // "Tudo em ordem" só quando não há NENHUMA recomendação ativa — inclui
    // permission_drift, que este método não gerencia mas cujo estado ainda
    // deve impedir o placeholder de "tudo limpo".
    const anyActive = await this.prisma.catalogRecommendation.count({ where: { dismissedAt: null } })
    if (anyActive === 0) {
      await this.prisma.catalogRecommendation.upsert({
        where: { dedupeKey: 'all_clear' },
        create: {
          dedupeKey: 'all_clear',
          type: 'all_clear',
          title: 'Catálogo em ordem',
          description: 'Nenhuma inconsistência ou ação urgente identificada.',
          priority: 'low',
          action: null,
          computedAt,
        },
        update: { computedAt },
      })
    } else {
      // Havia um all_clear de um ciclo anterior e agora surgiu algo real —
      // remove incondicionalmente, não deixa o placeholder "tudo em ordem"
      // sobrevivendo (dismissado ou não) ao lado de recomendações reais.
      await this.prisma.catalogRecommendation.deleteMany({ where: { dedupeKey: 'all_clear' } })
    }
  }
}
