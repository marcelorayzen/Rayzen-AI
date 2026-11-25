import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'

export interface HealthBreakdown {
  activity: number        // 0–100
  documentation: number   // 0–100
  consistency: number     // 0–100
  nextSteps: number       // 0–100
  blockers: number        // 0–100
  focus: number           // 0–100
}

export interface HealthScoreRecord {
  id: string
  projectId: string
  score: number
  breakdown: HealthBreakdown
  createdAt: string
}

const WEIGHTS = {
  activity:      0.20,
  documentation: 0.20,
  consistency:   0.20,
  nextSteps:     0.15,
  blockers:      0.15,
  focus:         0.10,
}

@Injectable()
export class HealthScoreService {
  constructor(private readonly prisma: PrismaService) {}

  async compute(projectId: string): Promise<HealthScoreRecord> {
    const now = Date.now()

    const [events, docs, state, recommendations, prevState] = await Promise.all([
      this.prisma.event.findMany({
        where: { projectId },
        orderBy: { ts: 'desc' },
        take: 1,
        select: { ts: true },
      }),
      this.prisma.projectDocument.findMany({
        where: { projectId },
        select: { generatedAt: true },
      }),
      this.prisma.projectState.findUnique({
        where: { projectId },
        select: {
          nextSteps: true,
          blockers: true,
          activeFocus: true,
          updatedAt: true,
        },
      }),
      this.prisma.projectRecommendation.findMany({
        where: { projectId, dismissedAt: null, type: 'consistency' },
        orderBy: { computedAt: 'desc' },
        take: 1,
        select: { priority: true, computedAt: true },
      }),
      // Previous state snapshot for blocker trend (compare by updatedAt)
      this.prisma.projectState.findUnique({
        where: { projectId },
        select: { blockers: true, updatedAt: true },
      }),
    ])

    // ── 1. Activity (20%) ────────────────────────────────────────────────────
    // 0d=100, 7d=70, 30d=0
    let activityScore = 0
    if (events.length > 0) {
      const daysSince = (now - events[0].ts.getTime()) / 86400000
      if (daysSince <= 0) activityScore = 100
      else if (daysSince <= 7) activityScore = Math.round(100 - (daysSince / 7) * 30)  // 100→70
      else if (daysSince <= 30) activityScore = Math.round(70 - ((daysSince - 7) / 23) * 70)  // 70→0
      else activityScore = 0
    }

    // ── 2. Documentation (20%) ───────────────────────────────────────────────
    // % of docs regenerated in the last 14 days
    let documentationScore = 0
    if (docs.length > 0) {
      const fourteenDaysAgo = new Date(now - 14 * 86400000)
      const fresh = docs.filter(d => d.generatedAt >= fourteenDaysAgo).length
      documentationScore = Math.round((fresh / docs.length) * 100)
    }

    // ── 3. Consistency (20%) ─────────────────────────────────────────────────
    // Based on latest consistency recommendation (if any and recent)
    let consistencyScore = 100
    if (recommendations.length > 0) {
      const rec = recommendations[0]
      const ageDays = (now - rec.computedAt.getTime()) / 86400000
      if (ageDays <= 7) {
        // Still relevant
        if (rec.priority === 'high') consistencyScore = 30
        else if (rec.priority === 'medium') consistencyScore = 60
        else consistencyScore = 80
      }
    }

    // ── 4. Next steps (15%) ──────────────────────────────────────────────────
    // >0 next_steps and state was updated within 5 days
    let nextStepsScore = 0
    if (state) {
      const steps = (state.nextSteps as string[]) ?? []
      const stateAgeDays = (now - state.updatedAt.getTime()) / 86400000
      if (steps.length > 0 && stateAgeDays <= 5) nextStepsScore = 100
      else if (steps.length > 0 && stateAgeDays <= 14) nextStepsScore = 60
      else if (steps.length > 0) nextStepsScore = 30
    }

    // ── 5. Blockers resolving (15%) ──────────────────────────────────────────
    // Simple heuristic: if blockers array is empty → 100; if has items but < previous → 60; same or more → 20
    let blockersScore = 100
    if (state) {
      const currentBlockers = ((state.blockers as string[]) ?? []).length
      if (currentBlockers === 0) blockersScore = 100
      else if (currentBlockers <= 2) blockersScore = 60
      else blockersScore = 20
    }

    // ── 6. Focus defined (10%) ───────────────────────────────────────────────
    const focusScore = state?.activeFocus ? 100 : 0

    const breakdown: HealthBreakdown = {
      activity: activityScore,
      documentation: documentationScore,
      consistency: consistencyScore,
      nextSteps: nextStepsScore,
      blockers: blockersScore,
      focus: focusScore,
    }

    const score = Math.round(
      breakdown.activity      * WEIGHTS.activity +
      breakdown.documentation * WEIGHTS.documentation +
      breakdown.consistency   * WEIGHTS.consistency +
      breakdown.nextSteps     * WEIGHTS.nextSteps +
      breakdown.blockers      * WEIGHTS.blockers +
      breakdown.focus         * WEIGHTS.focus
    )

    const record = await this.prisma.projectHealthScore.create({
      data: {
        projectId,
        score,
        breakdown: breakdown as object,
      },
    })

    return this.serialize(record)
  }

  async getCurrent(projectId: string): Promise<HealthScoreRecord | null> {
    const record = await this.prisma.projectHealthScore.findFirst({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
    })
    return record ? this.serialize(record) : null
  }

  async getHistory(projectId: string, days = 30): Promise<HealthScoreRecord[]> {
    const since = new Date(Date.now() - days * 86400000)
    const records = await this.prisma.projectHealthScore.findMany({
      where: { projectId, createdAt: { gte: since } },
      orderBy: { createdAt: 'asc' },
    })
    return records.map(r => this.serialize(r))
  }

  private serialize(r: {
    id: string
    projectId: string
    score: number
    breakdown: unknown
    createdAt: Date
  }): HealthScoreRecord {
    return {
      id: r.id,
      projectId: r.projectId,
      score: r.score,
      breakdown: r.breakdown as HealthBreakdown,
      createdAt: r.createdAt.toISOString(),
    }
  }
}
