import { Injectable } from '@nestjs/common'
import { PrismaV2Service } from '../core/prisma-v2.service'
import { V1ApiService } from '../core/v1-api.service'
import { MemoryClass } from '../memory/dto/memory.dto'

export type ProjectMemoryType = 'decision' | 'lesson' | 'pattern' | 'constraint' | 'assumption'

export interface IndexProjectMemoryDto {
  projectId:   string
  content:     string
  memoryType:  ProjectMemoryType
  missionId?:  string
  confidence?: number
  validUntil?: Date
  sourcePath?: string
}

@Injectable()
export class ProjectMemoryService {
  constructor(
    private readonly prisma:  PrismaV2Service,
    private readonly v1Api:   V1ApiService,
  ) {}

  async index(dto: IndexProjectMemoryDto) {
    // 1. Store in V1 (pgvector)
    const indexed = await this.v1Api.indexContent({
      projectId:  dto.projectId,
      content:    dto.content,
      sourcePath: dto.sourcePath ?? `project-memory/${dto.memoryType}`,
      sourceType: 'ai_generated',
    })

    if (!indexed.id) return { success: false }

    // 2. Tag in V2 — decisions and constraints go straight to consolidated
    const autoClass: MemoryClass = (dto.memoryType === 'decision' || dto.memoryType === 'constraint')
      ? 'consolidated'
      : 'working'

    const meta = await this.prisma.memoryMeta.upsert({
      where:  { v1DocumentId: indexed.id },
      create: {
        v1DocumentId: indexed.id,
        projectId:    dto.projectId,
        memoryClass:  autoClass,
        memoryType:   dto.memoryType,
        missionId:    dto.missionId,
        confidence:   dto.confidence ?? 0.8,
        validUntil:   dto.validUntil,
      },
      update: {
        memoryClass: autoClass,
        memoryType:  dto.memoryType,
        confidence:  dto.confidence ?? 0.8,
      },
    })

    return { success: true, documentId: indexed.id, memoryClass: meta.memoryClass }
  }

  async getDecisions(projectId: string) {
    const metas = await this.prisma.memoryMeta.findMany({
      where:   { projectId, memoryType: 'decision', memoryClass: { not: 'archive' } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    })
    const docIds = metas.map((m) => m.v1DocumentId)
    const docs   = await this.v1Api.listDocuments(projectId)
    const docMap = new Map(docs.map((d) => [d.id, d]))
    return metas.map((m) => ({
      ...m,
      content: docMap.get(m.v1DocumentId)?.content ?? null,
    }))
  }

  async getFailures(projectId: string) {
    const metas = await this.prisma.memoryMeta.findMany({
      where:   { projectId, memoryType: 'lesson', memoryClass: { not: 'archive' } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    })
    const docs = await this.v1Api.listDocuments(projectId)
    const docMap = new Map(docs.map((d) => [d.id, d]))
    return metas.map((m) => ({ ...m, content: docMap.get(m.v1DocumentId)?.content ?? null }))
  }

  async getSummary(projectId: string) {
    const stats = await this.prisma.memoryMeta.groupBy({
      by:    ['memoryClass', 'memoryType'],
      where: { projectId },
      _count: true,
    })

    const byClass: Record<string, number>  = {}
    const byType:  Record<string, number>  = {}
    let total = 0

    for (const s of stats) {
      byClass[s.memoryClass] = (byClass[s.memoryClass] ?? 0) + s._count
      if (s.memoryType) {
        byType[s.memoryType] = (byType[s.memoryType] ?? 0) + s._count
      }
      total += s._count
    }

    // Staleness: no access in 30 days
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    const staleCount = await this.prisma.memoryMeta.count({
      where: {
        projectId,
        OR: [
          { lastAccessAt: null },
          { lastAccessAt: { lt: thirtyDaysAgo } },
        ],
      },
    })

    const staleness = total > 0 ? Math.round((staleCount / total) * 100) : 0
    const score = Math.max(0, 100 - staleness - (byClass['inbox'] ? Math.round((byClass['inbox'] / total) * 30) : 0))

    return {
      projectId,
      totalTracked: total,
      byClass,
      byType,
      staleness,
      score,
    }
  }

  async indexFromEvent(event: { projectId: string; content: string; type?: string }) {
    // Auto-index events with decision intent
    if (!event.projectId) return
    return this.index({
      projectId:  event.projectId,
      content:    String(event.content),
      memoryType: 'decision',
      confidence: 0.7,
      sourcePath: `event/${event.type ?? 'decision'}`,
    })
  }
}
