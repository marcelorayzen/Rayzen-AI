// Extraído de QueryService pra ser testável sem mockar $queryRaw/Jina —
// mesmo princípio de substring-match.util.ts. Abaixo do limiar, o candidato
// é tratado como "não relevante" (equivalente a zero hits no substring
// anterior) — busca por similaridade sempre devolve ALGUM score, nunca zero.
export function aboveThreshold<T extends { score: number | string }>(rows: T[], threshold: number): T[] {
  return rows.filter((r) => Number(r.score) >= threshold)
}
