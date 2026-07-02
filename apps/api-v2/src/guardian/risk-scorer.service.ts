import { Injectable } from '@nestjs/common'
import {
  RISK_SCORE_TABLE,
  CRITICAL_MODULE_PATTERNS,
  SCHEMA_PATTERNS,
  MIGRATION_PATTERNS,
  classifyRisk,
  type RiskSignal,
} from './risk-score-table.const'
import type { SuggestedTest } from './test-gap-detector.service'

export type RiskLevel       = 'low' | 'medium' | 'high' | 'critical'
export type DeployRecommend = 'safe' | 'review' | 'block'

export interface RiskScoreInput {
  changedFiles:        string[]
  testGapCount:        number
  suggestions:         SuggestedTest[]
  totalChanged:        number
  jwtExpiresInDays?:   number   // presente quando o caller conhece o JWT
}

export interface RiskScoreResult {
  score:           number       // 0-100 determinístico via RISK_SCORE_TABLE
  level:           RiskLevel
  deployRecommend: DeployRecommend
  signals:         RiskSignal[] // critérios que dispararam
  reasons:         string[]     // mensagens legíveis
  recommendations: string[]     // sugestões de correção
}

@Injectable()
export class RiskScorerService {
  score(params: RiskScoreInput): RiskScoreResult {
    const { changedFiles, testGapCount, jwtExpiresInDays } = params
    const signals: RiskSignal[] = []
    const reasons:          string[] = []
    const recommendations:  string[] = []
    let total = 0

    const add = (signal: RiskSignal, reason: string, rec: string) => {
      if (signals.includes(signal)) return
      signals.push(signal)
      total += RISK_SCORE_TABLE[signal]
      reasons.push(reason)
      recommendations.push(rec)
    }

    // serviceSemSpec — arquivo testável sem spec
    if (testGapCount > 0) {
      add(
        'serviceSemSpec',
        `${testGapCount} arquivo(s) sem spec correspondente`,
        'Criar specs em __tests__/ antes de fazer push',
      )
    }

    for (const f of changedFiles) {
      const norm = f.replace(/\\/g, '/')

      // moduloCritico
      if (CRITICAL_MODULE_PATTERNS.some(p => p.test(norm))) {
        add(
          'moduloCritico',
          `Modulo critico alterado: ${norm}`,
          'Revisar mudancas em auth/mcp/hook/gateway/policy com cuidado redobrado',
        )
      }

      // alteracaoSchema
      if (SCHEMA_PATTERNS.some(p => p.test(norm))) {
        add(
          'alteracaoSchema',
          `Schema Prisma alterado: ${norm}`,
          'Executar db:generate e validar migration antes do push',
        )
      }

      // migrationSemTeste — migration sem spec no mesmo PR
      if (MIGRATION_PATTERNS.some(p => p.test(norm))) {
        const hasMigrationSpec = changedFiles.some(cf =>
          cf.includes('__tests__') && cf.includes('migration'),
        )
        if (!hasMigrationSpec) {
          add(
            'migrationSemTeste',
            `Migration sem teste de reversao: ${norm}`,
            'Adicionar teste que valida a migration pode ser revertida',
          )
        }
      }
    }

    // jwtProximoDeExpirar
    if (jwtExpiresInDays !== undefined && jwtExpiresInDays <= 7) {
      add(
        'jwtProximoDeExpirar',
        `JWT expira em ${jwtExpiresInDays} dia(s)`,
        'Renovar JWT via POST /auth/login antes de continuar',
      )
    }

    if (reasons.length === 0) reasons.push('Nenhum risco significativo detectado')

    const level           = classifyRisk(total)
    const deployRecommend = this.toRecommend(level)

    return { score: total, level, deployRecommend, signals, reasons, recommendations }
  }

  private toRecommend(level: RiskLevel): DeployRecommend {
    if (level === 'critical') return 'block'
    if (level === 'high')     return 'review'
    if (level === 'medium')   return 'review'
    return 'safe'
  }
}
