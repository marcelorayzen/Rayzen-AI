// Padrão copiado do RiskScorerService do Guardian (apps/api-v2/src/guardian/
// risk-score-table.const.ts) — tabela de pontos fixa + classificador por
// threshold. Sinais trocados: lá era "risco de a mudança de código quebrar
// produção", aqui é "risco de a resposta do agente estar errada ou vazar
// dado fora de escopo".

export type CatalogRiskSignal =
  | 'semCitacaoQuandoExigida'
  | 'linguagemEspeculativa'
  | 'misturaDeSensibilidade'
  | 'campoRestritoTocado'

export const CATALOG_RISK_SCORE_TABLE: Record<CatalogRiskSignal, number> = {
  semCitacaoQuandoExigida: 30, // resposta exigia citação de ativo e não citou nenhum
  linguagemEspeculativa: 30, // heurística de possível alucinação ("provavelmente", "deve ser"...)
  misturaDeSensibilidade: 20, // contexto combina ativo restricted/confidential com outros níveis
  campoRestritoTocado: 15, // pelo menos um campo restrito apareceu no contexto (mesmo redigido)
}

export type CatalogRiskLevel = 'low' | 'medium' | 'high' | 'critical'

export function classifyCatalogRisk(score: number): CatalogRiskLevel {
  if (score >= 70) return 'critical'
  if (score >= 45) return 'high'
  if (score >= 20) return 'medium'
  return 'low'
}
