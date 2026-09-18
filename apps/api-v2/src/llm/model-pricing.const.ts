/**
 * Preço por alias do LiteLLM — fonte única.
 *
 * Estava embutido só na tabela `TIERS` do AiRouterService, que é a única coisa
 * que gravava custo. Com o LlmService passando a gravar também, dois lugares
 * teriam o mesmo número: é o caso do `taskTypes` do benchmark, onde o QA
 * Scientist validava contra uma lista e o invariante rodava contra outra.
 *
 * Preço é **blended** (entrada+saída na mesma taxa) — aproximação deliberada:
 * a precisão que importa aqui é "quanto este módulo gastou hoje", não centavo.
 */
export const COST_PER_1M_USD: Record<string, number> = {
  'gpt-4o-mini':    0.10,
  'gpt-4o':         0.70,
  'gpt-4o-premium': 9.00,
  // Ollama local — não sai dinheiro. Registrar como 0 é diferente de não
  // registrar: mantém a chamada visível no painel com o custo que ela tem.
  'gpt-local':      0.00,
}

/** Alias desconhecido cai aqui — melhor superestimar que sumir do painel. */
export const COST_PER_1M_FALLBACK = 0.70

export function costUsdFor(modelAlias: string, tokens: number): number {
  const per1M = COST_PER_1M_USD[modelAlias] ?? COST_PER_1M_FALLBACK
  return (tokens / 1_000_000) * per1M
}
