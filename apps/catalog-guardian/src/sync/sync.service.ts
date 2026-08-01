import { Inject, Injectable, Logger } from '@nestjs/common'
import { PrismaService } from '../core/prisma.service'
import { CATALOG_ADAPTER, CatalogAdapter } from '../adapters/catalog-adapter.interface'
import { RawCatalogAsset } from '../adapters/catalog-adapter.types'
import { EmbeddingService } from '../embedding/embedding.service'

@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name)

  constructor(
    private readonly prisma: PrismaService,
    @Inject(CATALOG_ADAPTER) private readonly adapter: CatalogAdapter,
    private readonly embedding: EmbeddingService,
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
      // Lido ANTES do upsert de propósito — é o único lugar onde "valor
      // antigo vs valor novo" existe de verdade. CatalogProactiveService
      // roda de 30 em 30min contra o CatalogAsset já sincronizado por este
      // método (a cada 15min), então comparar lá sempre daria "sem
      // diferença" — mediria saúde do pipeline de sync, não drift real.
      const existing = await this.prisma.catalogAsset.findUnique({
        where: { source_externalId: { source: this.adapter.source, externalId: raw.externalId } },
      })
      if (existing) await this.recordDriftIfAny(existing, raw)

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
          firstSyncedAt: syncedAt,
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
          // firstSyncedAt nunca é tocado aqui — setado só na criação.
        },
      })
      idByExternalId.set(raw.externalId, asset.id)

      const contentChanged = !existing || existing.name !== raw.name || existing.description !== (raw.description ?? null)
      await this.maybeUpdateEmbedding(
        'catalog_assets',
        asset.id,
        !existing,
        contentChanged,
        `${raw.name} ${raw.description ?? ''}`.trim(),
      )
    }

    // Item 7: uma mesma edge A→B aparece na chamada de getLineage() tanto de
    // A (como downstream) quanto de B (como upstream) — o upsert no banco já
    // era idempotente (correto, nunca duplicava linha), mas o contador do
    // log incrementava a cada aparição, superestimando o total. `seenEdges`
    // deduplica pelo par sourceId/targetId antes de contar.
    let edgeCount = 0
    const seenEdges = new Set<string>()
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
        const edgeKey = `${sourceId}:${targetId}`
        if (!seenEdges.has(edgeKey)) {
          seenEdges.add(edgeKey)
          edgeCount++
        }
      }
    }

    const rawTerms = await this.adapter.listGlossaryTerms().catch((err) => {
      this.logger.warn(`listGlossaryTerms() falhou: ${(err as Error).message}`)
      return []
    })
    for (const raw of rawTerms) {
      const existingTerm = await this.prisma.catalogGlossaryTerm.findUnique({
        where: { source_externalId: { source: this.adapter.source, externalId: raw.externalId } },
      })

      const term = await this.prisma.catalogGlossaryTerm.upsert({
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

      const contentChanged =
        !existingTerm ||
        existingTerm.name !== raw.name ||
        existingTerm.displayName !== (raw.displayName ?? null) ||
        existingTerm.description !== (raw.description ?? null)
      await this.maybeUpdateEmbedding(
        'catalog_glossary_terms',
        term.id,
        !existingTerm,
        contentChanged,
        `${raw.name} ${raw.displayName ?? ''} ${raw.description ?? ''}`.trim(),
      )
    }

    const ms = Date.now() - started
    this.logger.log(
      `sync concluído em ${ms}ms — ${rawAssets.length} ativo(s), ${edgeCount} edge(s) de lineage, ${rawTerms.length} termo(s) de glossário`,
    )
    return { assets: rawAssets.length, edges: edgeCount, glossaryTerms: rawTerms.length }
  }

  // Backlog "busca substring" fechado: embedding calculado só quando precisa
  // — ativo novo, conteúdo mudou, ou (self-heal) a linha ainda não tinha
  // embedding de um sync anterior a esta migration. `embedding` é
  // Unsupported() no Prisma Client (nunca aparece no objeto normal), por
  // isso o SELECT via $queryRawUnsafe só roda no caso "conteúdo igual" —
  // evita 1 SELECT extra por ativo inalterado na maioria dos syncs.
  // table é sempre um literal fixo chamado por este arquivo, nunca input
  // externo — @executeRawUnsafe/@queryRawUnsafe seguros aqui.
  private async maybeUpdateEmbedding(
    table: 'catalog_assets' | 'catalog_glossary_terms',
    id: string,
    isNew: boolean,
    contentChanged: boolean,
    text: string,
  ): Promise<void> {
    let needsEmbedding = isNew || contentChanged
    if (!needsEmbedding) {
      // ::text explícito — sem cast, o driver do Prisma não sabe desserializar
      // o tipo `vector` (OID sem parser registrado) e lança em toda chamada,
      // não só quando a coluna é de fato null. Só apareceu rodando contra
      // Postgres real (fixture de teste mocka $queryRawUnsafe direto).
      const rows = await this.prisma.$queryRawUnsafe<Array<{ embedding: string | null }>>(
        `SELECT embedding::text AS embedding FROM ${table} WHERE id = $1`,
        id,
      )
      needsEmbedding = rows[0]?.embedding == null
    }
    if (!needsEmbedding) return

    try {
      const vector = await this.embedding.embed(text)
      await this.prisma.$executeRawUnsafe(`UPDATE ${table} SET embedding = $1::vector WHERE id = $2`, JSON.stringify(vector), id)
    } catch (err) {
      this.logger.warn(`embedding falhou pra ${table} ${id}: ${(err as Error).message}`)
    }
  }

  // Regra proativa permission_drift (Fase 4) — mora aqui, não no
  // CatalogProactiveService: este é o único lugar onde "valor antigo vs
  // valor novo" existe de verdade, antes do upsert sobrescrever a linha.
  // Evento único por mudança real — na sincronização seguinte o valor local
  // já foi atualizado, então não há re-detecção espúria do mesmo drift.
  private async recordDriftIfAny(
    existing: { name: string; domain: string | null; tags: unknown },
    raw: RawCatalogAsset,
  ): Promise<void> {
    const domainChanged = (raw.domain ?? null) !== existing.domain
    const existingTags = ((existing.tags as string[] | null) ?? []).slice().sort()
    const newTags = (raw.tags ?? []).slice().sort()
    const tagsChanged = JSON.stringify(existingTags) !== JSON.stringify(newTags)
    if (!domainChanged && !tagsChanged) return

    const title = domainChanged
      ? `"${existing.name}" mudou de domínio na fonte: ${existing.domain ?? 'nenhum'} → ${raw.domain ?? 'nenhum'}`
      : `"${existing.name}" mudou de classificação (tags) na fonte`
    const description = domainChanged
      ? `Domínio sincronizado localmente era "${existing.domain ?? 'nenhum'}", a fonte agora reporta "${raw.domain ?? 'nenhum'}" — quem tem acesso a este ativo pode ter mudado.`
      : `Tags anteriores: [${existingTags.join(', ') || 'nenhuma'}] → tags atuais: [${newTags.join(', ') || 'nenhuma'}].`

    await this.prisma.catalogRecommendation.create({
      data: {
        type: 'permission_drift',
        title,
        description,
        priority: domainChanged ? 'high' : 'medium',
        action: 'Revise se o novo domínio/classificação está correto e se quem acessa este ativo ainda deveria acessar.',
        computedAt: new Date(),
      },
    })
    this.logger.warn(`permission_drift detectado em "${existing.name}" (${domainChanged ? 'domain' : 'tags'})`)
  }
}
