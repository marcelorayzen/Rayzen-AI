// Baseline "simples antes de inteligente" (mesmo princípio de
// ownership-question.util.ts) — busca por palavra-chave em vez de
// embeddings. Compartilhado por findRelevantAssets() e
// findRelevantGlossaryTerms() no QueryService.
// minLength default 4 evita ruído de stopword (de/da/que/com...) na busca
// de tabela, que tem um corpus bem maior. Siglas de negócio (PMR, CPF...)
// costumam ter só 3 letras — findRelevantGlossaryTerms() chama isto com
// minLength menor, já que o corpus de termos é pequeno e o risco de match
// espúrio é baixo (SEM-005: "pmr" com o filtro padrão nunca seria comparado
// com o glossário).
export function tokenizeQuestion(question: string, minLength = 4): string[] {
  return question
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // remove acentos — pergunta pode vir sem eles (DESC-007)
    .split(/\s+/)
    // tira pontuação colada ("pedidos?" -> "pedidos"), mas preserva "_" —
    // nomes de termo/coluna em snake_case ("cliente_ativo") aparecem assim
    // na própria pergunta em alguns casos do golden dataset (SEM-002).
    .map((w) => w.replace(/[^\p{L}\p{N}_]/gu, ''))
    .filter((w) => w.length >= minLength)
}

export function topMatchesBySubstring<T>(items: T[], words: string[], haystackOf: (item: T) => string, limit = 5): T[] {
  return items
    .map((item) => {
      const haystack = haystackOf(item).toLowerCase()
      const hits = words.filter((w) => haystack.includes(w)).length
      return { item, hits }
    })
    .filter((s) => s.hits > 0)
    .sort((a, b) => b.hits - a.hits)
    .slice(0, limit)
    .map((s) => s.item)
}
