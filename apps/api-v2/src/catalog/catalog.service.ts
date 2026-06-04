import { Injectable } from '@nestjs/common'
import { Prisma } from '../../generated/prisma-client-v2'
import { PrismaV2Service } from '../core/prisma-v2.service'
import { V1BridgeService } from '../core/v1-bridge.service'

export interface UpsertCatalogDto {
  owner?: string
  provenance?: string
  tags?: string[]
  healthScore?: number | null
  metadata?: Record<string, unknown>
  archivedAt?: string | null
}

export interface CatalogEntry {
  catalogId:      string | null
  v1ProjectId:    string
  name:           string
  repoSlug:       string | null
  description:    string | null
  owner:          string | null
  provenance:     string
  tags:           string[]
  healthScore:    number | null
  metadata:       Record<string, unknown>
  missionCount:   number
  lastMissionAt:  Date | null
  archivedAt:     Date | null
  updatedAt:      Date | null
}

@Injectable()
export class CatalogService {
  constructor(
    private readonly prisma: PrismaV2Service,
    private readonly bridge: V1BridgeService,
  ) {}

  async list(): Promise<CatalogEntry[]> {
    const [v1Projects, catalogRows, missionAgg] = await Promise.all([
      this.bridge.listProjects(),
      this.prisma.projectCatalog.findMany(),
      this.prisma.mission.groupBy({
        by: ['projectId'],
        _count: { id: true },
        _max:   { createdAt: true },
      }),
    ])

    const catalogMap = new Map(catalogRows.map((r) => [r.v1ProjectId, r]))
    const missionMap = new Map(missionAgg.map((r) => [r.projectId, r]))

    return v1Projects.map((p) => {
      const cat  = catalogMap.get(p.id) ?? null
      const miss = missionMap.get(p.id) ?? null
      return {
        catalogId:    cat?.id ?? null,
        v1ProjectId:  p.id,
        name:         p.name,
        repoSlug:     p.repoSlug ?? null,
        description:  p.description ?? null,
        owner:        cat?.owner ?? null,
        provenance:   cat?.provenance ?? 'manual',
        tags:         cat?.tags ?? [],
        healthScore:  cat?.healthScore ?? null,
        metadata:     (cat?.metadata as Record<string, unknown>) ?? {},
        missionCount: miss?._count.id ?? 0,
        lastMissionAt: miss?._max.createdAt ?? null,
        archivedAt:   cat?.archivedAt ?? null,
        updatedAt:    cat?.updatedAt ?? null,
      }
    })
  }

  async upsert(v1ProjectId: string, dto: UpsertCatalogDto): Promise<CatalogEntry> {
    await this.prisma.projectCatalog.upsert({
      where:  { v1ProjectId },
      create: {
        v1ProjectId,
        owner:       dto.owner ?? null,
        provenance:  dto.provenance ?? 'manual',
        tags:        dto.tags ?? [],
        healthScore: dto.healthScore ?? null,
        metadata:    (dto.metadata ?? {}) as Prisma.InputJsonValue,
        archivedAt:  dto.archivedAt ? new Date(dto.archivedAt) : null,
      },
      update: {
        ...(dto.owner       !== undefined && { owner:       dto.owner }),
        ...(dto.provenance  !== undefined && { provenance:  dto.provenance }),
        ...(dto.tags        !== undefined && { tags:        dto.tags }),
        ...(dto.healthScore !== undefined && { healthScore: dto.healthScore }),
        ...(dto.metadata    !== undefined && { metadata:    dto.metadata as Prisma.InputJsonValue }),
        ...(dto.archivedAt  !== undefined && { archivedAt:  dto.archivedAt ? new Date(dto.archivedAt) : null }),
      },
    })

    const entries = await this.list()
    return entries.find((e) => e.v1ProjectId === v1ProjectId) as CatalogEntry
  }

  async remove(v1ProjectId: string): Promise<void> {
    await this.prisma.projectCatalog.deleteMany({ where: { v1ProjectId } })
  }
}
