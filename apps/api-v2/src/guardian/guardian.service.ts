import { Injectable, Logger } from '@nestjs/common'
import { PrismaV2Service } from '../core/prisma-v2.service'
import { TestGapDetectorService } from './test-gap-detector.service'
import { RiskScorerService, RiskLevel, DeployRecommend } from './risk-scorer.service'
import { ApprovalGatesService } from '../approval-gates/approval-gates.service'
import * as os from 'os'
import * as path from 'path'
import * as fs from 'fs'
import * as crypto from 'crypto'

export interface GuardianAnalyzeDto {
  projectId:    string
  repoPath:     string
  changedFiles: string[]
  allFiles?:    string[]
}

export interface GuardianReport {
  id:                string
  projectId:         string
  repoPath:          string
  changedFiles:      string[]
  impactedRoutes:    unknown[]
  impactedModules:   string[]
  filesWithoutTests: string[]
  suggestedTests:    unknown[]
  riskScore:         number
  riskLevel:         RiskLevel
  deployRecommend:   DeployRecommend
  summary:           string
  overridden:        boolean
  createdAt:         Date
}

const CACHE_TTL_MS = 10 * 60 * 1000

@Injectable()
export class GuardianService {
  private readonly logger = new Logger(GuardianService.name)

  constructor(
    private readonly prisma:        PrismaV2Service,
    private readonly gapDetector:   TestGapDetectorService,
    private readonly riskScorer:    RiskScorerService,
    private readonly approvalGates: ApprovalGatesService,
  ) {}

  async analyze(dto: GuardianAnalyzeDto): Promise<GuardianReport> {
    const allFiles = dto.allFiles ?? []
    const gaps     = this.gapDetector.detect(dto.changedFiles, allFiles)
    const missing  = gaps.filter(g => !g.exists)
    const suggestions = this.gapDetector.buildSuggestions(gaps)

    const risk = this.riskScorer.score({
      changedFiles:  dto.changedFiles,
      testGapCount:  missing.length,
      suggestions,
      totalChanged:  dto.changedFiles.length,
    })

    const impactedModules = [...new Set(
      dto.changedFiles.map(f => {
        const parts = f.replace(/\\/g, '/').split('/')
        const srcIdx = parts.lastIndexOf('src')
        return srcIdx >= 0 && parts[srcIdx + 1] ? parts[srcIdx + 1] : parts[parts.length - 2] ?? 'unknown'
      })
    )]

    const summary = this.buildSummary(dto.changedFiles.length, missing.length, risk.score, risk.level, risk.reasons)

    const report = await this.prisma.guardianReport.create({
      data: {
        projectId:         dto.projectId,
        repoPath:          dto.repoPath,
        changedFiles:      dto.changedFiles,
        impactedRoutes:    [],
        impactedModules,
        filesWithoutTests: missing.map(g => g.sourceFile),
        suggestedTests:    suggestions as never,
        riskScore:         risk.score,
        riskLevel:         risk.level,
        deployRecommend:   risk.deployRecommend,
        summary,
        // Blueprint v1.1 — campos determinísticos
        score:           risk.score,
        signals:         risk.signals as never,
        reason:          risk.reasons[0] ?? null,
        missingSpecs:    missing as never,
        affectedFiles:   dto.changedFiles as never,
        recommendations: risk.recommendations as never,
        status:          'open',
      },
    })

    this.writeCache(dto.projectId, report as GuardianReport)
    this.logger.log(`Guardian report created: ${report.id} — ${risk.level} (${risk.score})`)

    await this.approvalGates.createFromGuardianReport({
      projectId: dto.projectId,
      reportId:  report.id,
      riskLevel: risk.level,
      score:     risk.score,
      summary,
    }).catch(err => {
      this.logger.warn(`Falha ao criar approval gate para guardian report ${report.id}: ${err instanceof Error ? err.message : err}`)
    })

    return report as GuardianReport
  }

  async getLatest(projectId: string): Promise<GuardianReport | null> {
    const cached = this.readCache(projectId)
    if (cached) return cached

    const report = await this.prisma.guardianReport.findFirst({
      where:   { projectId },
      orderBy: { createdAt: 'desc' },
    })
    return report as GuardianReport | null
  }

  async getHistory(projectId: string): Promise<GuardianReport[]> {
    const reports = await this.prisma.guardianReport.findMany({
      where:   { projectId },
      orderBy: { createdAt: 'desc' },
      take:    20,
    })
    return reports as GuardianReport[]
  }

  async override(id: string, reason: string): Promise<GuardianReport> {
    const report = await this.prisma.guardianReport.update({
      where: { id },
      data:  { overridden: true, overrideReason: reason },
    })
    return report as GuardianReport
  }

  private buildSummary(changed: number, gaps: number, score: number, level: RiskLevel, reasons: string[]): string {
    const emoji = { low: '✅', medium: '⚠️', high: '🔴', critical: '🚨' }[level]
    return `${emoji} ${level.toUpperCase()} (${score}) — ${changed} arquivo(s) alterado(s), ${gaps} sem teste. ${reasons.slice(0, 2).join('; ')}`
  }

  private cacheFile(projectId: string): string {
    const hash = crypto.createHash('sha256').update(projectId).digest('hex').slice(0, 8)
    return path.join(os.tmpdir(), `rayzen-guardian-${hash}.json`)
  }

  private writeCache(projectId: string, report: GuardianReport): void {
    try {
      fs.writeFileSync(this.cacheFile(projectId), JSON.stringify({ report, expiresAt: Date.now() + CACHE_TTL_MS }))
    } catch { /* non-critical */ }
  }

  private readCache(projectId: string): GuardianReport | null {
    try {
      const raw = fs.readFileSync(this.cacheFile(projectId), 'utf8')
      const { report, expiresAt } = JSON.parse(raw) as { report: GuardianReport; expiresAt: number }
      return Date.now() < expiresAt ? report : null
    } catch { return null }
  }
}
