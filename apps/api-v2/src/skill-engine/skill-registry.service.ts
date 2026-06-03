import { Injectable, Logger } from '@nestjs/common'
import { PrismaV2Service } from '../core/prisma-v2.service'
import { SkillDefinition, SkillCategory, SkillRegistry, SKILL_DEFINITIONS_EXPORT } from './skill-registry'

export interface SkillStats {
  skillId:       string
  totalRuns:     number
  successCount:  number
  failureCount:  number
  successRate:   number   // 0-1
  avgDurationMs: number
  lastUsedAt:    Date | null
}

export interface ProjectSkillStats {
  projectId:    string
  totalRuns:    number
  successRate:  number
  topSkills:    SkillStats[]
  recentLogs:   Array<{
    id:         string
    skillId:    string
    success:    boolean
    durationMs: number
    createdAt:  Date
  }>
}

export interface CreateSkillAssetDto {
  skillId:      string
  name:         string
  description:  string
  category:     SkillCategory
  risk:         'none' | 'low' | 'medium' | 'high'
  runtime:      'in-process' | 'agent-desktop' | 'agent-server'
  version?:     string
  inputSchema?: Record<string, unknown>
  outputSchema?: Record<string, unknown>
  tags?:        string[]
  owner?:       string
  estimatedMs?: number
}

@Injectable()
export class SkillRegistryService {
  private readonly logger = new Logger(SkillRegistryService.name)
  private readonly staticRegistry = new SkillRegistry()

  constructor(private readonly prisma: PrismaV2Service) {}

  /**
   * Resolve uma skill: DB tem precedência sobre o registry estático.
   * DB entry com enabled=false → skill desabilitada.
   */
  async resolve(skillId: string): Promise<SkillDefinition | null> {
    const asset = await this.prisma.skillAsset.findUnique({ where: { skillId } })

    if (asset) {
      if (!asset.enabled) return null
      return this.assetToDefinition(asset)
    }

    return this.staticRegistry.get(skillId) ?? null
  }

  /**
   * Lista todas as skills (estáticas + DB), com DB sobrescrevendo estática.
   * Skills desabilitadas no DB são excluídas.
   */
  async listAll(category?: string): Promise<SkillDefinition[]> {
    const dbAssets = await this.prisma.skillAsset.findMany({
      where: {
        enabled: true,
        ...(category ? { category } : {}),
      },
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
    })

    const dbIds   = new Set(dbAssets.map((a) => a.skillId))
    const dbSkills = dbAssets.map((a) => this.assetToDefinition(a))

    // Inclui skills estáticas que não foram sobrescritas no DB
    const staticSkills = this.staticRegistry.list(category as SkillCategory | undefined)
      .filter((s) => !dbIds.has(s.id))

    return [...dbSkills, ...staticSkills]
      .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name))
  }

  /** Registra uma skill custom ou override de uma estática. */
  async create(dto: CreateSkillAssetDto): Promise<SkillDefinition> {
    const asset = await this.prisma.skillAsset.upsert({
      where:  { skillId: dto.skillId },
      create: {
        skillId:      dto.skillId,
        name:         dto.name,
        description:  dto.description,
        category:     dto.category,
        risk:         dto.risk,
        runtime:      dto.runtime,
        version:      dto.version ?? '1.0',
        inputSchema:  (dto.inputSchema  ?? {}) as object,
        outputSchema: (dto.outputSchema ?? {}) as object,
        tags:         dto.tags ?? [],
        owner:        dto.owner,
        estimatedMs:  dto.estimatedMs,
        builtIn:      false,
        enabled:      true,
      },
      update: {
        name:         dto.name,
        description:  dto.description,
        category:     dto.category,
        risk:         dto.risk,
        runtime:      dto.runtime,
        version:      dto.version ?? '1.0',
        inputSchema:  (dto.inputSchema  ?? {}) as object,
        outputSchema: (dto.outputSchema ?? {}) as object,
        tags:         dto.tags ?? [],
        owner:        dto.owner,
        estimatedMs:  dto.estimatedMs,
        updatedAt:    new Date(),
      },
    })
    return this.assetToDefinition(asset)
  }

  async updateAsset(skillId: string, patch: {
    enabled?:     boolean
    description?: string
    tags?:        string[]
    version?:     string
    risk?:        string
    estimatedMs?: number
  }) {
    return this.prisma.skillAsset.update({
      where: { skillId },
      data:  { ...patch, updatedAt: new Date() },
    })
  }

  async deleteAsset(skillId: string) {
    return this.prisma.skillAsset.delete({ where: { skillId } })
  }

  /**
   * Sincroniza todas as skills estáticas para o DB (builtIn=true).
   * Não sobrescreve assets customizados (builtIn=false).
   */
  async sync(): Promise<{ synced: number }> {
    const statics = SKILL_DEFINITIONS_EXPORT
    let synced = 0

    for (const s of statics) {
      const existing = await this.prisma.skillAsset.findUnique({ where: { skillId: s.id } })
      if (existing && !existing.builtIn) continue  // custom override — não sobrescreve

      await this.prisma.skillAsset.upsert({
        where:  { skillId: s.id },
        create: {
          skillId:      s.id,
          name:         s.name,
          description:  s.description,
          category:     s.category,
          risk:         s.risk,
          runtime:      s.runtime,
          version:      s.version,
          inputSchema:  s.inputSchema as object,
          outputSchema: s.outputSchema as object,
          tags:         [],
          builtIn:      true,
          enabled:      true,
          estimatedMs:  s.estimatedMs,
        },
        update: {
          name:         s.name,
          description:  s.description,
          category:     s.category,
          risk:         s.risk,
          runtime:      s.runtime,
          version:      s.version,
          inputSchema:  s.inputSchema as object,
          outputSchema: s.outputSchema as object,
          builtIn:      true,
          updatedAt:    new Date(),
        },
      })
      synced++
    }

    this.logger.log(`Synced ${synced} built-in skills to DB`)
    return { synced }
  }

  // ─── Usage tracking ──────────────────────────────────────────────────────────

  async logUsage(entry: {
    skillId:    string
    projectId?: string
    missionId?: string
    stepId?:    string
    success:    boolean
    durationMs: number
    error?:     string
  }) {
    return this.prisma.skillUsageLog.create({
      data: {
        skillId:    entry.skillId,
        projectId:  entry.projectId,
        missionId:  entry.missionId,
        stepId:     entry.stepId,
        success:    entry.success,
        durationMs: entry.durationMs,
        error:      entry.error,
      },
    })
  }

  async getProjectStats(projectId: string, limit = 10): Promise<ProjectSkillStats> {
    const logs = await this.prisma.skillUsageLog.findMany({
      where:   { projectId },
      orderBy: { createdAt: 'desc' },
      take:    500,
    })

    const totalRuns     = logs.length
    const successCount  = logs.filter((l) => l.success).length
    const successRate   = totalRuns > 0 ? successCount / totalRuns : 0

    // Aggregate per skill
    const skillMap = new Map<string, { total: number; success: number; totalMs: number; lastAt: Date }>()
    for (const log of logs) {
      const agg = skillMap.get(log.skillId) ?? { total: 0, success: 0, totalMs: 0, lastAt: log.createdAt }
      agg.total++
      if (log.success) agg.success++
      agg.totalMs += log.durationMs
      if (log.createdAt > agg.lastAt) agg.lastAt = log.createdAt
      skillMap.set(log.skillId, agg)
    }

    const topSkills: SkillStats[] = [...skillMap.entries()]
      .map(([skillId, agg]) => ({
        skillId,
        totalRuns:     agg.total,
        successCount:  agg.success,
        failureCount:  agg.total - agg.success,
        successRate:   agg.total > 0 ? agg.success / agg.total : 0,
        avgDurationMs: agg.total > 0 ? Math.round(agg.totalMs / agg.total) : 0,
        lastUsedAt:    agg.lastAt,
      }))
      .sort((a, b) => b.totalRuns - a.totalRuns)
      .slice(0, limit)

    const recentLogs = logs.slice(0, 20).map((l) => ({
      id:         l.id,
      skillId:    l.skillId,
      success:    l.success,
      durationMs: l.durationMs,
      createdAt:  l.createdAt,
    }))

    return { projectId, totalRuns, successRate, topSkills, recentLogs }
  }

  async getSkillStats(skillId: string): Promise<SkillStats> {
    const logs = await this.prisma.skillUsageLog.findMany({
      where:   { skillId },
      orderBy: { createdAt: 'desc' },
      take:    1000,
    })

    const totalRuns    = logs.length
    const successCount = logs.filter((l) => l.success).length
    const totalMs      = logs.reduce((s, l) => s + l.durationMs, 0)

    return {
      skillId,
      totalRuns,
      successCount,
      failureCount:  totalRuns - successCount,
      successRate:   totalRuns > 0 ? successCount / totalRuns : 0,
      avgDurationMs: totalRuns > 0 ? Math.round(totalMs / totalRuns) : 0,
      lastUsedAt:    logs[0]?.createdAt ?? null,
    }
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  categories(): SkillCategory[] {
    return this.staticRegistry.categories()
  }

  private assetToDefinition(asset: {
    skillId: string; name: string; description: string; category: string
    risk: string; runtime: string; version: string
    inputSchema: unknown; outputSchema: unknown; estimatedMs: number | null
  }): SkillDefinition {
    return {
      id:           asset.skillId,
      name:         asset.name,
      description:  asset.description,
      category:     asset.category as SkillCategory,
      risk:         asset.risk    as SkillDefinition['risk'],
      runtime:      asset.runtime as SkillDefinition['runtime'],
      version:      asset.version,
      inputSchema:  (asset.inputSchema  ?? {}) as Record<string, unknown>,
      outputSchema: (asset.outputSchema ?? {}) as Record<string, unknown>,
      estimatedMs:  asset.estimatedMs ?? undefined,
    }
  }
}
