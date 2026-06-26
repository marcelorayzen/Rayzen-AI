import { Injectable } from '@nestjs/common'
import type { SuggestedTest } from './test-gap-detector.service'

export type RiskLevel      = 'low' | 'medium' | 'high' | 'critical'
export type DeployRecommend = 'safe' | 'review' | 'block'

export interface RiskResult {
  score:           number
  level:           RiskLevel
  deployRecommend: DeployRecommend
  reasons:         string[]
}

// High-impact paths add weight regardless of test coverage
const HIGH_IMPACT_PATTERNS = [
  /auth/i, /security/i, /whitelist/i, /payment/i, /permission/i, /role/i,
  /prisma/i, /migration/i, /gateway/i, /main\.ts$/,
]

const CRITICAL_PATTERNS = [
  /whitelist\.ts$/, /deploy\.sh$/, /prisma\/schema\.prisma$/,
]

@Injectable()
export class RiskScorerService {
  score(params: {
    changedFiles:   string[]
    testGapCount:   number
    suggestions:    SuggestedTest[]
    totalChanged:   number
  }): RiskResult {
    const { changedFiles, testGapCount, totalChanged } = params
    const reasons: string[] = []
    let score = 0

    // Base: one point per changed file
    score += Math.min(totalChanged * 0.5, 3)

    // Test gaps: 1.5 per untested file
    if (testGapCount > 0) {
      score += testGapCount * 1.5
      reasons.push(`${testGapCount} file(s) sem spec correspondente`)
    }

    // High-impact files
    for (const f of changedFiles) {
      if (CRITICAL_PATTERNS.some(p => p.test(f))) {
        score += 8
        reasons.push(`Arquivo crítico alterado: ${f}`)
      } else if (HIGH_IMPACT_PATTERNS.some(p => p.test(f))) {
        score += 1.5
        reasons.push(`Arquivo de alto impacto: ${f}`)
      }
    }

    const level           = this.toLevel(score)
    const deployRecommend = this.toRecommend(level)

    if (reasons.length === 0) reasons.push('Nenhum risco significativo detectado')

    return { score: Math.round(score * 10) / 10, level, deployRecommend, reasons }
  }

  private toLevel(score: number): RiskLevel {
    if (score >= 8) return 'critical'
    if (score >= 6) return 'high'
    if (score >= 3) return 'medium'
    return 'low'
  }

  private toRecommend(level: RiskLevel): DeployRecommend {
    if (level === 'critical') return 'block'
    if (level === 'high')     return 'review'
    if (level === 'medium')   return 'review'
    return 'safe'
  }
}
