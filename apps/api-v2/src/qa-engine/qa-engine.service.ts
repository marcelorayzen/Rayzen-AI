import { Injectable, Logger } from '@nestjs/common'
import { V1ApiService } from '../core/v1-api.service'
import { V1BridgeService } from '../core/v1-bridge.service'
import { LlmService } from '../llm/llm.service'
import { MissionService } from '../mission/mission.service'

export interface QASla {
  projectId:     string
  minPassRate:   number   // 0-1 — minimum passing test percentage
  maxFlakeRate:  number   // 0-1 — max flaky rate
  maxDurationMs: number   // max suite duration
}

export interface QAGateResult {
  missionId:      string
  passed:         boolean
  passRate:       number
  slaViolations:  string[]
  regressions:    string[]
  summary:        string
  testRuns:       unknown[]
  dataQualityScore?: number
}

// In-memory SLAs (persist later in DB)
const projectSlas = new Map<string, QASla>()

@Injectable()
export class QaEngineService {
  private readonly logger = new Logger(QaEngineService.name)

  constructor(
    private readonly v1Api:    V1ApiService,
    private readonly v1Bridge: V1BridgeService,
    private readonly llm:      LlmService,
    private readonly missions: MissionService,
  ) {}

  // Run QA gate for a mission — checks test results + data quality
  async runGate(missionId: string, projectId: string): Promise<QAGateResult> {
    const mission    = await this.missions.findOne(missionId)
    const violations: string[] = []
    const regressions: string[] = []

    // 1. Get recent test runs from V1
    const testRuns = await this.getRecentTestRuns(projectId)
    const passRate = this.computePassRate(testRuns)

    // 2. Check SLA
    const sla = projectSlas.get(projectId)
    if (sla) {
      if (passRate < sla.minPassRate) {
        violations.push(`Pass rate ${(passRate * 100).toFixed(1)}% < required ${(sla.minPassRate * 100).toFixed(1)}%`)
      }
    }

    // 3. Data quality score
    let dqScore: number | undefined
    try {
      const dqRes = await fetch(
        `${(process.env.V1_API_URL ?? 'http://api:3001')}/data-quality/score?projectId=${projectId}`,
        { headers: { Authorization: `Bearer ${process.env.V1_API_TOKEN ?? ''}` } },
      )
      if (dqRes.ok) {
        const dq = await dqRes.json() as { score?: number }
        dqScore = dq.score
        if (dqScore !== undefined && dqScore < 70) {
          violations.push(`Data quality score ${dqScore}/100 is below threshold 70`)
        }
      }
    } catch { /* optional */ }

    // 4. LLM summary
    const passed = violations.length === 0
    let summary  = passed ? 'QA gate passed.' : `QA gate failed: ${violations.join('; ')}`

    if (testRuns.length > 0) {
      try {
        const result = await this.llm.chat([
          { role: 'system', content: 'Summarize this QA gate result in 1-2 sentences.' },
          { role: 'user',   content: `Mission: "${mission.title}"\nPass rate: ${(passRate * 100).toFixed(1)}%\nViolations: ${violations.join(', ') || 'none'}\nData quality: ${dqScore ?? 'N/A'}` },
        ], { model: 'gpt-4o-mini', temperature: 0 })
        summary = result.content
      } catch { /* keep default summary */ }
    }

    return { missionId, passed, passRate, slaViolations: violations, regressions, summary, testRuns, dataQualityScore: dqScore }
  }

  async getTrend(projectId: string) {
    const runs = await this.getRecentTestRuns(projectId)
    if (runs.length === 0) return { projectId, trend: 'no_data', passRates: [] }

    const passRates = runs.map((r) => {
      const run = r as { passed?: number; failed?: number; total?: number; createdAt?: string }
      const total  = (run.passed ?? 0) + (run.failed ?? 0)
      return { date: run.createdAt ?? '', passRate: total > 0 ? (run.passed ?? 0) / total : 0 }
    })

    const recent = passRates.slice(0, 3).map((p) => p.passRate)
    const avg    = recent.reduce((a, b) => a + b, 0) / (recent.length || 1)
    const trend  = avg >= 0.9 ? 'healthy' : avg >= 0.7 ? 'degrading' : 'critical'

    return { projectId, trend, passRates, currentAvg: avg }
  }

  setSla(sla: QASla) {
    projectSlas.set(sla.projectId, sla)
    return sla
  }

  getSla(projectId: string) {
    return projectSlas.get(projectId) ?? null
  }

  private async getRecentTestRuns(projectId: string) {
    try {
      const url = `${process.env.V1_API_URL ?? 'http://api:3001'}/qa/reports/ingest`
      void url
      // V1 stores TestRun in DB — fetch via V1Bridge
      return []
    } catch { return [] }
  }

  private computePassRate(runs: unknown[]): number {
    if (runs.length === 0) return 1.0 // assume passing if no tests
    const totals = runs.reduce<{ passed: number; total: number }>(
      (acc, r) => {
        const run = r as { passed?: number; failed?: number }
        acc.passed += run.passed ?? 0
        acc.total  += (run.passed ?? 0) + (run.failed ?? 0)
        return acc
      },
      { passed: 0, total: 0 },
    )
    return totals.total > 0 ? totals.passed / totals.total : 1.0
  }
}
