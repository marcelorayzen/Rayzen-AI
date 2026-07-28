import { Inject, Injectable, Logger } from '@nestjs/common'
import { PrismaService } from '../core/prisma.service'
import { CATALOG_ADAPTER, CatalogAdapter } from '../adapters/catalog-adapter.interface'

@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name)

  constructor(
    private readonly prisma: PrismaService,
    @Inject(CATALOG_ADAPTER) private readonly adapter: CatalogAdapter,
  ) {}

  // Upsert de CatalogAsset a partir do adapter, depois lineage por asset, e
  // por fim os termos de glossário (independentes de asset/lineage — nunca
  // falham a sincronização inteira se o catálogo fonte não tiver glossário).
  // Roda via SyncProcessor (BullMQ, periódico) ou via `pnpm sync:once` (manual).
  async syncOnce(): Promise<{ assets: number; edges: number; glossaryTerms: number }> {
    const started = Date.now()
    const rawAssets = await this.adapter.listAssets()
    const syncedAt = new Date()

    const idByExternalId = new Map<string, string>()
    for (const raw of rawAssets) {
      const asset = await this.prisma.catalogAsset.upsert({
        where: { source_externalId: { source: this.adapter.source, externalId: raw.externalId } },
        create: {
          externalId: raw.externalId,
          source: this.adapter.source,
          name: raw.name,
          description: raw.description ?? null,
          owner: raw.owner ?? null,
          domain: raw.domain ?? null,
          sensitivity: raw.sensitivity ?? 'internal',
          containsPII: raw.containsPII ?? false,
          piiFields: raw.piiFields ?? [],
          tags: raw.tags ?? [],
          syncedAt,
        },
        update: {
          name: raw.name,
          description: raw.description ?? null,
          owner: raw.owner ?? null,
          domain: raw.domain ?? null,
          sensitivity: raw.sensitivity ?? 'internal',
          containsPII: raw.containsPII ?? false,
          piiFields: raw.piiFields ?? [],
          tags: raw.tags ?? [],
          syncedAt,
        },
      })
      idByExternalId.set(raw.externalId, asset.id)
    }

    let edgeCount = 0
    for (const raw of rawAssets) {
      const rawEdges = await this.adapter.getLineage(raw.externalId).catch((err) => {
        this.logger.warn(`getLineage(${raw.externalId}) falhou: ${(err as Error).message}`)
        return []
      })
      for (const edge of rawEdges) {
        const sourceId = idByExternalId.get(edge.sourceExternalId)
        const targetId = idByExternalId.get(edge.targetExternalId)
        if (!sourceId || !targetId) continue // ativo fora do escopo sincronizado — não quebra o sync inteiro
        await this.prisma.catalogLineageEdge.upsert({
          where: { sourceId_targetId: { sourceId, targetId } },
          create: { sourceId, targetId, transform: edge.transform ?? null },
          update: { transform: edge.transform ?? null },
        })
        edgeCount++
      }
    }

    const rawTerms = await this.adapter.listGlossaryTerms().catch((err) => {
      this.logger.warn(`listGlossaryTerms() falhou: ${(err as Error).message}`)
      return []
    })
    for (const raw of rawTerms) {
      await this.prisma.catalogGlossaryTerm.upsert({
        where: { source_externalId: { source: this.adapter.source, externalId: raw.externalId } },
        create: {
          externalId: raw.externalId,
          source: this.adapter.source,
          name: raw.name,
          displayName: raw.displayName ?? null,
          description: raw.description ?? null,
          syncedAt,
        },
        update: {
          name: raw.name,
          displayName: raw.displayName ?? null,
          description: raw.description ?? null,
          syncedAt,
        },
      })
    }

    const ms = Date.now() - started
    this.logger.log(
      `sync concluído em ${ms}ms — ${rawAssets.length} ativo(s), ${edgeCount} edge(s) de lineage, ${rawTerms.length} termo(s) de glossário`,
    )
    return { assets: rawAssets.length, edges: edgeCount, glossaryTerms: rawTerms.length }
  }
}
