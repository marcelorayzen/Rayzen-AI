import { Injectable } from '@nestjs/common'
import {
  RISK_SCORE_TABLE,
  CRITICAL_MODULE_PATTERNS,
  SCHEMA_PATTERNS,
  MIGRATION_PATTERNS,
  DOCS_GERADOS,
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
  /**
   * Horas desde a última execução de teste registrada, ou `null` quando não há
   * nenhuma. `undefined` = o caller não sabe, e o sinal não é avaliado.
   */
  horasDesdeUltimoTeste?: number | null
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
  /** Acima disto, as mudanças no working tree não foram validadas por execução nenhuma. */
  private static readonly HORAS_SEM_TESTE = 4

  score(params: RiskScoreInput): RiskScoreResult {
    const { changedFiles, testGapCount, jwtExpiresInDays, horasDesdeUltimoTeste } = params
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

    // docDesatualizada — gerador tocado sem regenerar o doc que ele produz.
    // Checável só com os paths: se a fonte está no changeset e o doc gerado não
    // está, o doc passou a mentir sobre o código.
    for (const { doc, comando, fontes } of DOCS_GERADOS) {
      const normalizados = changedFiles.map((f) => f.replace(/\\/g, '/'))
      const fonteMudou   = normalizados.some((f) => fontes.some((p) => p.test(f)))
      const docRegerado  = normalizados.includes(doc)
      if (fonteMudou && !docRegerado) {
        add(
          'docDesatualizada',
          `${doc} desatualizado — a fonte mudou e o doc não foi regerado`,
          `Rodar \`${comando}\` e incluir ${doc} no commit`,
        )
      }
    }

    // semTesteRodado — nenhuma execução recente cobriu as mudanças.
    // `undefined` = o caller não sabe (não avalia). `null` = nunca houve execução.
    if (horasDesdeUltimoTeste !== undefined) {
      const nunca = horasDesdeUltimoTeste === null
      if (nunca || horasDesdeUltimoTeste > RiskScorerService.HORAS_SEM_TESTE) {
        add(
          'semTesteRodado',
          nunca
            ? 'Nenhuma execução de teste registrada para este projeto'
            : `Última execução de teste há ${Math.round(horasDesdeUltimoTeste)}h — as mudanças atuais não foram validadas`,
          'Rodar `pnpm qa:ingest` (ou aguardar o CI) antes do push',
        )
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
