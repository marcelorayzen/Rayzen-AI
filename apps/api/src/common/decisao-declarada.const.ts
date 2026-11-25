/**
 * ── "Isto é uma decisão?" — uma definição, dois consumidores ────────────────
 *
 * Estava só no parser de blueprint. Em 18/09 a conversa do HUB passou a precisar da mesma
 * pergunta, e copiar teria criado a família de drift que esta casa já pagou quatro vezes com
 * `SAFE_ROOTS`. Mesmo app, então aqui é import de verdade, não cópia com teste anti-drift.
 *
 * ── O que ela NÃO faz ───────────────────────────────────────────────────────
 *
 * Não julga se a decisão é boa, nem extrai qual é. Ela responde se o texto **se apresenta** como
 * decisão — e quem usa precisa guardar o texto original, nunca uma reformulação. Registrar "o
 * Marcelo decidiu X" a partir de um casamento de regex seria inventar fato; registrar a frase dele
 * é registro.
 */

export const DECISION_PATTERNS = [
  /\bdecidi(do|mos|u)\b/i,
  /\bescolh(emos|ido|a)\b/i,
  /\boptamos\b/i,
  /\bwill use\b/i,
  /\badotamos\b/i,
  /\baprovado\b/i,
  /\bADR\b/,
]

/**
 * Nega só o que vem ANTES do verbo.
 *
 * "não decidido" é negação; "decidimos não usar X" é decisão real com um "não" depois do verbo.
 * `\p{L}` em vez de `\w` porque a janela pode conter acento ("ainda não foi aprovado").
 */
export const NEGACAO_ANTES = /\b(n[ãa]o|nunca|jamais|sem|ainda\s+n[ãa]o|nada\s+foi)\b[^.;!?]{0,40}$/iu

/**
 * Um texto só é decisão se o padrão casar **e não estiver negado**.
 *
 * O parser dizia que "não decidido" é decisão: `/\bdecidi(do|mos|u)\b/i` casa dentro de "não
 * decidido", e o item virava `type: 'decision'` com o texto literal — afirmando que há decisão
 * exatamente onde o texto diz o contrário.
 *
 * Pego em 2026-08-18 ao importar `blueprints/025-hud-mission-control.md`, cujas duas únicas linhas
 * casadas eram negadas. Nada chegou ao banco — mas chegaria, e decisão fantasma é permanente na
 * timeline do projeto.
 */
export function pareceDecisao(texto: string): boolean {
  return DECISION_PATTERNS.some((p) => {
    const m = p.exec(texto)
    if (!m) return false
    return !NEGACAO_ANTES.test(texto.slice(0, m.index))
  })
}
