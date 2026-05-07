import { Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'

export interface ModelInfo {
  name: string
  fields: Array<{ name: string; type: string; modifiers: string }>
  relations: string[]
}

export interface SchemaChangeSummary {
  modelsAdded: string[]
  modelsRemoved: string[]
  fieldsAdded: Array<{ model: string; field: string }>
  fieldsRemoved: Array<{ model: string; field: string }>
  impactedRules: number
}

export interface RuleDefinition {
  // not_null: no params needed
  // unique: no params needed
  // range: min?, max?
  min?: number
  max?: number
  // regex: pattern
  pattern?: string
  // freshness: maxAgeHours
  maxAgeHours?: number
  // custom: raw SQL returning count of failing rows
  sql?: string
  // optional description
  description?: string
}

export interface CreateRuleDto {
  projectId?: string
  dataset: string
  field?: string
  ruleType: 'not_null' | 'unique' | 'range' | 'regex' | 'custom' | 'freshness'
  definition?: RuleDefinition
  severity?: 'critical' | 'warning' | 'info'
}

export interface RunResultDto {
  ruleId: string
  passed: boolean
  score: number
  detail?: object
}

@Injectable()
export class DataQualityService {
  constructor(private readonly prisma: PrismaService) {}

  async createRule(dto: CreateRuleDto) {
    return this.prisma.dataQualityRule.create({
      data: {
        projectId: dto.projectId ?? null,
        dataset: dto.dataset,
        field: dto.field ?? null,
        ruleType: dto.ruleType,
        definition: (dto.definition ?? {}) as object,
        severity: dto.severity ?? 'warning',
      },
    })
  }

  async getRules(projectId?: string, dataset?: string) {
    return this.prisma.dataQualityRule.findMany({
      where: {
        ...(projectId ? { projectId } : {}),
        ...(dataset ? { dataset } : {}),
        active: true,
      },
      orderBy: { createdAt: 'desc' },
    })
  }

  async getRule(id: string) {
    const rule = await this.prisma.dataQualityRule.findUnique({ where: { id } })
    if (!rule) throw new NotFoundException(`Rule ${id} not found`)
    return rule
  }

  async deleteRule(id: string) {
    await this.getRule(id)
    return this.prisma.dataQualityRule.update({ where: { id }, data: { active: false } })
  }

  // Records a result manually (from agent or external runner)
  async recordResult(dto: RunResultDto) {
    return this.prisma.dataQualityResult.create({
      data: {
        ruleId: dto.ruleId,
        passed: dto.passed,
        score: dto.score,
        detail: dto.detail !== undefined ? (dto.detail as object) : undefined,
      },
    })
  }

  async getResults(ruleId: string, limit = 20) {
    return this.prisma.dataQualityResult.findMany({
      where: { ruleId },
      orderBy: { checkedAt: 'desc' },
      take: limit,
    })
  }

  // Aggregate score per dataset: weighted average of latest result per rule
  // critical weight=3, warning weight=2, info weight=1
  async computeDatasetScore(projectId?: string, dataset?: string): Promise<{
    dataset: string
    score: number
    rules: number
    failing: number
    detail: Array<{ ruleId: string; field: string | null; ruleType: string; severity: string; score: number; passed: boolean }>
  }[]> {
    const rules = await this.prisma.dataQualityRule.findMany({
      where: {
        ...(projectId ? { projectId } : {}),
        ...(dataset ? { dataset } : {}),
        active: true,
      },
    })

    // Group by dataset
    const byDataset: Record<string, typeof rules> = {}
    for (const r of rules) {
      if (!byDataset[r.dataset]) byDataset[r.dataset] = []
      byDataset[r.dataset].push(r)
    }

    const results: ReturnType<typeof this.computeDatasetScore> extends Promise<infer T> ? T : never = []

    for (const [ds, dsRules] of Object.entries(byDataset)) {
      const WEIGHTS: Record<string, number> = { critical: 3, warning: 2, info: 1 }
      let weightedSum = 0
      let weightTotal = 0
      let failing = 0
      const detail: Array<{ ruleId: string; field: string | null; ruleType: string; severity: string; score: number; passed: boolean }> = []

      for (const rule of dsRules) {
        const latest = await this.prisma.dataQualityResult.findFirst({
          where: { ruleId: rule.id },
          orderBy: { checkedAt: 'desc' },
        })

        const score = latest?.score ?? 1.0  // assume passing if never run
        const passed = latest?.passed ?? true
        const w = WEIGHTS[rule.severity] ?? 1

        weightedSum += score * w
        weightTotal += w
        if (!passed) failing++

        detail.push({ ruleId: rule.id, field: rule.field, ruleType: rule.ruleType, severity: rule.severity, score, passed })
      }

      results.push({
        dataset: ds,
        score: weightTotal > 0 ? Math.round((weightedSum / weightTotal) * 100) : 100,
        rules: dsRules.length,
        failing,
        detail,
      })
    }

    return results
  }

  async getScoreHistory(projectId?: string, dataset?: string, days = 30) {
    const since = new Date(Date.now() - days * 86400_000)

    const results = await this.prisma.dataQualityResult.findMany({
      where: {
        checkedAt: { gte: since },
        rule: {
          ...(projectId ? { projectId } : {}),
          ...(dataset ? { dataset } : {}),
          active: true,
        },
      },
      include: { rule: { select: { severity: true, dataset: true } } },
      orderBy: { checkedAt: 'asc' },
    })

    // Group by day
    const byDay: Record<string, { sum: number; total: number; weights: number }> = {}
    const WEIGHTS: Record<string, number> = { critical: 3, warning: 2, info: 1 }

    for (const r of results) {
      const day = r.checkedAt.toISOString().slice(0, 10)
      if (!byDay[day]) byDay[day] = { sum: 0, total: 0, weights: 0 }
      const w = WEIGHTS[r.rule.severity] ?? 1
      byDay[day].sum += r.score * w
      byDay[day].weights += w
      byDay[day].total++
    }

    return Object.entries(byDay).map(([date, d]) => ({
      date,
      score: Math.round((d.sum / d.weights) * 100),
      checks: d.total,
    }))
  }

  async getSummary(projectId?: string) {
    const scores = await this.computeDatasetScore(projectId)
    const rules = await this.prisma.dataQualityRule.count({
      where: { ...(projectId ? { projectId } : {}), active: true },
    })
    const totalFailing = scores.reduce((s, d) => s + d.failing, 0)
    const avgScore = scores.length > 0
      ? Math.round(scores.reduce((s, d) => s + d.score, 0) / scores.length)
      : 100

    return { datasets: scores, totalRules: rules, totalFailing, avgScore }
  }

  async diffSchema(models: ModelInfo[], projectId?: string): Promise<{ hasChanges: boolean; changes?: SchemaChangeSummary }> {
    // Load previous snapshot
    const prevSnapshot = await this.prisma.schemaSnapshot.findFirst({
      where: projectId ? { projectId } : {},
      orderBy: { capturedAt: 'desc' },
    })

    // Save new snapshot
    await this.prisma.schemaSnapshot.create({
      data: { projectId: projectId ?? null, models: models as unknown as object[] },
    })

    if (!prevSnapshot) return { hasChanges: false }

    const prev = prevSnapshot.models as unknown as ModelInfo[]
    const prevMap = new Map(prev.map(m => [m.name, m]))
    const currMap = new Map(models.map(m => [m.name, m]))

    const modelsAdded = models.filter(m => !prevMap.has(m.name)).map(m => m.name)
    const modelsRemoved = prev.filter(m => !currMap.has(m.name)).map(m => m.name)
    const fieldsAdded: Array<{ model: string; field: string }> = []
    const fieldsRemoved: Array<{ model: string; field: string }> = []

    for (const [name, currModel] of currMap) {
      const prevModel = prevMap.get(name)
      if (!prevModel) continue
      const prevFields = new Set(prevModel.fields.map(f => f.name))
      const currFields = new Set(currModel.fields.map(f => f.name))
      for (const f of currFields) if (!prevFields.has(f)) fieldsAdded.push({ model: name, field: f })
      for (const f of prevFields) if (!currFields.has(f)) fieldsRemoved.push({ model: name, field: f })
    }

    const hasChanges = modelsAdded.length + modelsRemoved.length + fieldsAdded.length + fieldsRemoved.length > 0
    if (!hasChanges) return { hasChanges: false }

    // Check which active rules reference removed models/fields
    const allRules = await this.prisma.dataQualityRule.findMany({
      where: { ...(projectId ? { projectId } : {}), active: true },
      select: { dataset: true, field: true },
    })

    const removedDatasets = new Set(modelsRemoved.map(m => m.toLowerCase()))
    const removedFields = new Set(fieldsRemoved.map(({ model, field }) => `${model.toLowerCase()}.${field}`))

    let impactedRules = 0
    for (const rule of allRules) {
      const ds = rule.dataset.toLowerCase()
      const fieldKey = rule.field ? `${ds}.${rule.field}` : null
      if (removedDatasets.has(ds) || (fieldKey && removedFields.has(fieldKey))) {
        impactedRules++
      }
    }

    const changes: SchemaChangeSummary = { modelsAdded, modelsRemoved, fieldsAdded, fieldsRemoved, impactedRules }
    return { hasChanges: true, changes }
  }
}
