import { Injectable } from '@nestjs/common'
import {
  CATALOG_RISK_SCORE_TABLE,
  classifyCatalogRisk,
  CatalogRiskLevel,
  CatalogRiskSignal,
} from './catalog-risk-score-table.const'

export type AnswerRecommend = 'safe' | 'review' | 'block'

export interface CatalogRiskScoreInput {
  requiresCitation: boolean
  citedAssetsCount: number
  speculativeLanguageDetected: boolean
  sensitivityLevelsInContext: string[] // ex: ['internal', 'restricted']
  restrictedFieldsTouched: number
}

export interface CatalogRiskScoreResult {
  score: number
  level: CatalogRiskLevel
  recommend: AnswerRecommend
  signals: CatalogRiskSignal[]
  reasons: string[]
}

@Injectable()
export class CatalogRiskScorerService {
  score(input: CatalogRiskScoreInput): CatalogRiskScoreResult {
    const signals: CatalogRiskSignal[] = []
    const reasons: string[] = []
    let total = 0

    const add = (signal: CatalogRiskSignal, reason: string) => {
      if (signals.includes(signal)) return
      signals.push(signal)
      total += CATALOG_RISK_SCORE_TABLE[signal]
      reasons.push(reason)
    }

    if (input.requiresCitation && input.citedAssetsCount === 0) {
      add('semCitacaoQuandoExigida', 'Pergunta exige citação de ativo, mas a resposta não citou nenhum')
    }

    if (input.speculativeLanguageDetected) {
      add('linguagemEspeculativa', 'Linguagem especulativa detectada na resposta (possível alucinação)')
    }

    const distinctLevels = new Set(input.sensitivityLevelsInContext)
    const hasRestrictedOrConfidential = [...distinctLevels].some((l) => l === 'restricted' || l === 'confidential')
    if (hasRestrictedOrConfidential && distinctLevels.size > 1) {
      add('misturaDeSensibilidade', `Contexto mistura níveis de sensibilidade: ${[...distinctLevels].join(', ')}`)
    }

    if (input.restrictedFieldsTouched > 0) {
      add('campoRestritoTocado', `${input.restrictedFieldsTouched} campo(s) restrito(s) tocado(s) no contexto`)
    }

    if (reasons.length === 0) reasons.push('Nenhum risco significativo detectado')

    const level = classifyCatalogRisk(total)
    return { score: total, level, recommend: this.toRecommend(level), signals, reasons }
  }

  private toRecommend(level: CatalogRiskLevel): AnswerRecommend {
    if (level === 'critical') return 'block'
    if (level === 'high' || level === 'medium') return 'review'
    return 'safe'
  }
}
