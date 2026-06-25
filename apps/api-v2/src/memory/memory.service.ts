import { Injectable, Logger } from '@nestjs/common'
import { PrismaV2Service } from '../core/prisma-v2.service'
import { V1ApiService } from '../core/v1-api.service'
import { StoreMemoryDto, SearchMemoryDto, MemoryClass } from './dto/memory.dto'

// Mode-based class boosts: some modes prefer specific memory classes
const MODE_CLASS_BOOST: Record<string, Record<string, number>> = {
  debugging:      { working: 0.15, inbox: 0.05 },
  review:         { consolidated: 0.15, archive: 0.05 },
  architecture:   { consolidated: 0.20 },
  implementation: { working: 0.10, inbox: 0.05 },
  study:          { consolidated: 0.10, inbox: 0.05 },
}

@Injectable()
export class MemoryService {
  private readonly logger = new Logger(MemoryService.name)

  constructor(
    private readonly prisma: PrismaV2Service,
    private readonly v1Api: V1ApiService,
  ) {}

  async store(dto: StoreMemoryDto) {
    // 1. Index in V1 storage (pgvector)
    const indexed = await this.v1Api.indexContent({
      projectId:  dto.projectId,
      content:    dto.content,
      sourcePath: dto.sourcePath,
      sourceType: dto.sourceType ?? 'manual',
    })

    if (!indexed.id) return { success: true, documentId: null, memoryClass: dto.memoryClass ?? 'inbox' }

    // 2. Upsert lifecycle metadata in v2
    const meta = await this.prisma.memoryMeta.upsert({
      where:  { v1DocumentId: indexed.id },
      create: {
        v1DocumentId: indexed.id,
        projectId:    dto.projectId,
        memoryClass:  dto.memoryClass ?? 'inbox',
      },
      update: { memoryClass: dto.memoryClass ?? 'inbox', updatedAt: new Date() },
    })

    return { success: true, documentId: indexed.id, memoryClass: meta.memoryClass }
  }

  async search(dto: SearchMemoryDto) {
    const limit = dto.limit ?? 10

    // Search V1 — raw path (vector only, no LLM synthesis) to stay within hook timeout budget
    const results = await this.v1Api.searchMemoryRaw(dto.projectId, dto.query, Math.min(limit * 2, 50))

    if (results.length === 0) return { results: [], total: 0 }

    // Fetch lifecycle metadata for results
    const docIds = results.map((r) => r.id)
    const metas  = await this.prisma.memoryMeta.findMany({
      where: { v1DocumentId: { in: docIds }, projectId: dto.projectId },
    })
    const metaMap = new Map(metas.map((m) => [m.v1DocumentId, m]))

    // Filter by requested classes
    const classFilter = dto.classes ?? (['inbox', 'working', 'consolidated'] as MemoryClass[])

    // Apply mode-based boost + class filter
    const modeBoosts = dto.mode ? (MODE_CLASS_BOOST[dto.mode] ?? {}) : {}

    const seenContent = new Set<string>()
    const scored = results
      .map((r) => {
        const meta  = metaMap.get(r.id)
        const cls   = (meta?.memoryClass ?? 'inbox') as MemoryClass
        const boost = (modeBoosts[cls] as number | undefined) ?? 0
        return { ...r, memoryClass: cls, accessCount: meta?.accessCount ?? 0, score: r.score + boost }
      })
      .filter((r) => classFilter.includes(r.memoryClass as MemoryClass))
      .sort((a, b) => b.score - a.score)
      .filter((r) => {
        const fp = (r.content ?? '').slice(0, 200)
        if (seenContent.has(fp)) return false
        seenContent.add(fp)
        return true
      })
      .slice(0, limit)

    // Update access counts for retrieved docs
    void this.trackAccess(scored.map((r) => r.id), dto.projectId)

    return { results: scored, total: scored.length }
  }

  async list(projectId: string, memoryClass?: MemoryClass) {
    const docs = await this.v1Api.listDocuments(projectId)

    // Enrich with V2 lifecycle
    const metas = await this.prisma.memoryMeta.findMany({
      where: {
        projectId,
        ...(memoryClass ? { memoryClass } : {}),
      },
    })
    const metaMap = new Map(metas.map((m) => [m.v1DocumentId, m]))

    return docs.map((d) => ({
      ...d,
      memoryClass:  metaMap.get(d.id)?.memoryClass ?? 'inbox',
      accessCount:  metaMap.get(d.id)?.accessCount ?? 0,
      lastAccessAt: metaMap.get(d.id)?.lastAccessAt ?? null,
    }))
  }

  async updateClass(documentId: string, projectId: string, memoryClass: MemoryClass) {
    return this.prisma.memoryMeta.upsert({
      where:  { v1DocumentId: documentId },
      create: { v1DocumentId: documentId, projectId, memoryClass },
      update: { memoryClass },
    })
  }

  async delete(documentId: string) {
    await this.v1Api.deleteDocument(documentId)
    await this.prisma.memoryMeta.deleteMany({ where: { v1DocumentId: documentId } })
  }

  async stats(projectId: string) {
    const metas = await this.prisma.memoryMeta.groupBy({
      by: ['memoryClass'],
      where: { projectId },
      _count: true,
    })

    const distribution = Object.fromEntries(metas.map((m) => [m.memoryClass, m._count]))
    const totalInV2    = metas.reduce((s, m) => s + m._count, 0)

    return { projectId, totalTracked: totalInV2, distribution }
  }

  private async trackAccess(docIds: string[], projectId: string) {
    try {
      await this.prisma.memoryMeta.updateMany({
        where: { v1DocumentId: { in: docIds }, projectId },
        data:  { accessCount: { increment: 1 }, lastAccessAt: new Date() },
      })
      // Promote inbox → working after 3 accesses
      const candidates = await this.prisma.memoryMeta.findMany({
        where: { v1DocumentId: { in: docIds }, projectId, memoryClass: 'inbox', accessCount: { gte: 3 } },
      })
      if (candidates.length > 0) {
        await this.prisma.memoryMeta.updateMany({
          where: { id: { in: candidates.map((c) => c.id) } },
          data:  { memoryClass: 'working' },
        })
        this.logger.log(`Promoted ${candidates.length} memories inbox→working`)
      }
    } catch (e) {
      this.logger.warn(`trackAccess failed: ${e}`)
    }
  }
}
