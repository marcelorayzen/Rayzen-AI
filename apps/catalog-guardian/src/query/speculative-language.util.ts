// Espelha PADROES_INVENCAO em golden-dataset/avaliador.py — mesma heurística
// de linguagem especulativa, usada aqui como sinal de entrada do
// CatalogRiskScorerService (não como o único mecanismo anti-alucinação: o
// avaliador.py aplica a mesma checagem de novo, de fora, na avaliação).
const SPECULATIVE_PATTERNS = [
  /\bprovavelmente\b/i,
  /\bdeve ser\b/i,
  /\bimagino que\b/i,
  /\bgeralmente (?:significa|indica)\b/i,
  /\bpelo nome\b/i,
]

export function detectSpeculativeLanguage(text: string): boolean {
  return SPECULATIVE_PATTERNS.some((p) => p.test(text))
}
