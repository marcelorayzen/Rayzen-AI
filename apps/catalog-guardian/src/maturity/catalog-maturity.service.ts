import { Injectable } from '@nestjs/common'
import { PrismaService } from '../core/prisma.service'

export interface MaturityDimension {
  key: string
  label: string
  score: number // 0-100
  evidence: Record<string, unknown>
  insufficientData: boolean // sampleSize abaixo de MIN_SAMPLE_SIZE — ver comentário em pct()
}

export interface MaturityReport {
  generatedAt: string
  overallScore: number
  band: string
  dimensions: MaturityDimension[]
  disclaimer: string
}

const LOW_CONFIDENCE_WINDOW_DAYS = 30

// Pesos da penalidade de débito de governança — mesmo padrão de tabela fixa
// de CATALOG_RISK_SCORE_TABLE (risk-scorer), não um cálculo "aprendido".
const RECOMMENDATION_PENALTY = { high: 15, medium: 8, low: 3 }

const BANDS: Array<{ min: number; label: string }> = [
  { min: 90, label: 'otimizado' },
  { min: 70, label: 'gerenciado' },
  { min: 40, label: 'em desenvolvimento' },
  { min: 0, label: 'inicial' },
]

// Item 7 (revisão pós-Fase 6): abaixo deste limiar, uma dimensão sem nenhum
// dado (denominador 0 → pct() default 100, "sem evidência de problema") não
// pode fazer o relatório inteiro aparentar "otimizado" — um catálogo recém
// sincronizado, sem nenhum uso ainda, não é maduro, só não tem dado. Ver
// `insufficientData` em cada dimensão e o override de banda em computeReport().
const MIN_SAMPLE_SIZE = 3

function bandFor(score: number): string {
  return BANDS.find((b) => score >= b.min)!.label
}

function pct(numerator: number, denominator: number): number {
  if (denominator === 0) return 100 // sem dado = sem evidência de problema, ver evidence.sampleSize
  return Math.round((numerator / denominator) * 100)
}

// Scorecard determinístico (sem LLM como árbitro, mesmo princípio de
// CatalogRiskScorerService) sobre dado que o próprio Catalog Guardian já
// acumula. Cada dimensão é uma heurística mensurável, inspirada nos knowledge
// areas do DAMA-DMBOK (Governança, Metadados, Segurança, Integração,
// Qualidade) — NÃO é uma avaliação de maturidade DAMA certificada, que exige
// entrevista/auditoria humana. `disclaimer` no relatório existe pra isso
// nunca ser confundido com um selo oficial.
@Injectable()
export class CatalogMaturityService {
  constructor(private readonly prisma: PrismaService) {}

  async computeReport(): Promise<MaturityReport> {
    const totalAssets = await this.prisma.catalogAsset.count()
    const dimensions = await Promise.all([
      this.ownership(totalAssets),
      this.classification(),
      this.lineageCoverage(),
      this.queryQuality(),
      this.governanceProcessHealth(),
      this.governanceDebt(totalAssets),
    ])

    const overallScore = Math.round(dimensions.reduce((sum, d) => sum + d.score, 0) / dimensions.length)
    // Item 7: se NENHUMA dimensão tem amostra suficiente, o catálogo só está
    // vazio/recém-sincronizado — "otimizado"/"gerenciado" seria enganoso pra
    // um comitê que veja este relatório sem o contexto de que não há dado
    // nenhum ainda. Banda por score só se aplica quando pelo menos uma
    // dimensão tem evidência real.
    const allInsufficient = dimensions.every((d) => d.insufficientData)
    const band = allInsufficient ? 'dados insuficientes' : bandFor(overallScore)

    return {
      generatedAt: new Date().toISOString(),
      overallScore,
      band,
      dimensions,
      disclaimer:
        'Scorecard heurístico calculado a partir do catálogo sincronizado e do histórico de consultas deste Catalog Guardian — inspirado nos knowledge areas do DAMA-DMBOK, não uma avaliação de maturidade DAMA certificada (que exige entrevista/auditoria humana).',
    }
  }

  private async ownership(total: number): Promise<MaturityDimension> {
    const withOwner = await this.prisma.catalogAsset.count({ where: { owner: { not: null } } })
    return {
      key: 'ownership',
      label: 'Ownership',
      score: pct(withOwner, total),
      evidence: { totalAssets: total, withOwner, sampleSize: total },
      insufficientData: total < MIN_SAMPLE_SIZE,
    }
  }

  private async classification(): Promise<MaturityDimension> {
    const assets = await this.prisma.catalogAsset.findMany({ select: { tags: true } })
    const classified = assets.filter((a) => ((a.tags as string[] | null) ?? []).length > 0).length
    return {
      key: 'classification',
      label: 'Classificação',
      score: pct(classified, assets.length),
      evidence: { totalAssets: assets.length, classified, sampleSize: assets.length },
      insufficientData: assets.length < MIN_SAMPLE_SIZE,
    }
  }

  private async lineageCoverage(): Promise<MaturityDimension> {
    const assets = await this.prisma.catalogAsset.findMany({
      select: { id: true, lineageFrom: { select: { id: true }, take: 1 }, lineageTo: { select: { id: true }, take: 1 } },
    })
    const withLineage = assets.filter((a) => a.lineageFrom.length > 0 || a.lineageTo.length > 0).length
    return {
      key: 'lineage_coverage',
      label: 'Cobertura de linhagem',
      score: pct(withLineage, assets.length),
      evidence: { totalAssets: assets.length, withLineage, sampleSize: assets.length },
      insufficientData: assets.length < MIN_SAMPLE_SIZE,
    }
  }

  private async queryQuality(): Promise<MaturityDimension> {
    const windowStart = new Date(Date.now() - LOW_CONFIDENCE_WINDOW_DAYS * 86400000)
    const audits = await this.prisma.queryAudit.findMany({
      where: { createdAt: { gte: windowStart } },
      select: { riskLevel: true },
    })
    const highRisk = audits.filter((a) => a.riskLevel === 'high' || a.riskLevel === 'critical').length
    const riskScore = pct(audits.length - highRisk, audits.length)

    const flags = await this.prisma.queryAuditFlag.count()
    const resolvedFlags = await this.prisma.queryAuditFlag.count({ where: { resolvedAt: { not: null } } })
    const flagScore = pct(resolvedFlags, flags)
    const sampleSize = audits.length + flags

    return {
      key: 'query_quality',
      label: 'Qualidade de resposta',
      score: Math.round((riskScore + flagScore) / 2),
      evidence: {
        queriesUltimos30Dias: audits.length,
        altoRiscoOuCritico: highRisk,
        flagsTotal: flags,
        flagsResolvidas: resolvedFlags,
        sampleSize,
      },
      insufficientData: sampleSize < MIN_SAMPLE_SIZE,
    }
  }

  private async governanceProcessHealth(): Promise<MaturityDimension> {
    const total = await this.prisma.reviewGate.count()
    const decided = await this.prisma.reviewGate.count({ where: { status: { in: ['approved', 'rejected'] } } })
    return {
      key: 'governance_process',
      label: 'Saúde do processo de governança',
      score: pct(decided, total),
      evidence: { totalGates: total, decididos: decided, sampleSize: total },
      insufficientData: total < MIN_SAMPLE_SIZE,
    }
  }

  // sampleSize aqui é o tamanho do CATÁLOGO (totalAssets), não a contagem de
  // recomendações ativas — zero recomendação ativa é o resultado BOM desta
  // dimensão (motor proativo rodou e não achou problema), não falta de
  // amostra. Falta de amostra é não ter catálogo nenhum pra avaliar.
  private async governanceDebt(totalAssets: number): Promise<MaturityDimension> {
    const active = await this.prisma.catalogRecommendation.findMany({
      where: { dismissedAt: null, type: { not: 'all_clear' } },
      select: { priority: true },
    })
    const counts = { high: 0, medium: 0, low: 0 }
    for (const rec of active) {
      const p = rec.priority as keyof typeof counts
      if (p in counts) counts[p] += 1
    }
    const penalty =
      counts.high * RECOMMENDATION_PENALTY.high +
      counts.medium * RECOMMENDATION_PENALTY.medium +
      counts.low * RECOMMENDATION_PENALTY.low
    return {
      key: 'governance_debt',
      label: 'Débito de governança em aberto',
      score: Math.max(0, 100 - penalty),
      evidence: { recomendacoesAtivas: active.length, ...counts, sampleSize: totalAssets },
      insufficientData: totalAssets < MIN_SAMPLE_SIZE,
    }
  }
}
