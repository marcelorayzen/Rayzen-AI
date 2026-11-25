/**
 * ── HC7a: a resposta é falada em pedaços, nunca cortada ──────────────────────
 *
 * Medido em 22-23/11 contra o Gemini TTS (grupo `tts-1`), com 106 a 466 caracteres por chamada:
 * ~7 s para ficar pronto. Com 1.015 caracteres, a chamada **falhou com 500 depois de 158 s**: o
 * Gemini devolveu resposta sem áudio e o LiteLLM quebrou ao ler o vazio. Além disso, o serviço
 * cortava todo texto em 800 caracteres sem avisar, e a resposta mediana do Hub tem 1.107. A fala
 * parava no meio de uma frase.
 *
 * Por isso o texto é quebrado em frases inteiras de até `TETO_DO_PEDACO`. Quem fala pede um pedaço
 * por vez e prepara o próximo enquanto o atual toca: a primeira palavra sai em ~7 s, e nenhum
 * pedaço chega perto do tamanho que falha.
 */
export const TETO_DO_PEDACO = 350

/** Teto de uma chamada de síntese. Acima disto, recusa em vez de cortar calado. */
export const TETO_DA_SINTESE = 500

/**
 * Tira o que soa mal ou não existe na fala: markdown, marcadores de lista, cercas de código,
 * tabelas, links (fica o texto) e os marcadores internos `[DOC_PENDING:…]`/`[ACTION_PENDING:…]`.
 */
export function limparParaFala(texto: string): string {
  return texto
    .replace(/\[(?:DOC|ACTION)_PENDING:[A-Za-z0-9+/=]*\]/g, '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/`(.+?)`/g, '$1')
    .replace(/\[(.+?)\]\(.+?\)/g, '$1')
    .replace(/^\s*#+\s*/gm, '')
    .replace(/^\s*(?:[-*•]|\d+[.)])\s+/gm, '')
    .replace(/^\s*\|?[\s:-]*\|[\s|:-]*$/gm, '')
    .replace(/\|/g, ', ')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Uma frase maior que o teto: corta em vírgula/ponto e vírgula e, em último caso, em espaço. */
function partirFraseLonga(frase: string, teto: number): string[] {
  const partes: string[] = []
  let resto = frase.trim()
  while (resto.length > teto) {
    const janela = resto.slice(0, teto + 1)
    let corte = Math.max(janela.lastIndexOf(', '), janela.lastIndexOf('; '), janela.lastIndexOf(': '))
    if (corte < teto / 3) corte = janela.lastIndexOf(' ')
    if (corte <= 0) corte = teto // uma "palavra" maior que o teto: não há como não partir
    else corte += 1
    partes.push(resto.slice(0, corte).trim())
    resto = resto.slice(corte).trim()
  }
  if (resto) partes.push(resto)
  return partes
}

/**
 * Quebra o texto em pedaços para falar: frases inteiras juntas até o teto, sem nunca cortar uma
 * palavra. A ordem e o conteúdo são preservados; só o markdown sai.
 */
export function pedacosParaFala(texto: string, teto = TETO_DO_PEDACO): string[] {
  const limpo = limparParaFala(texto)
  if (!limpo) return []

  // Fim de frase (. ! ? …, seguido de espaço) ou quebra de linha.
  const frases = limpo
    .split(/(?<=[.!?…])\s+|\n+/)
    .map((f) => f.trim())
    .filter(Boolean)
    .flatMap((f) => (f.length > teto ? partirFraseLonga(f, teto) : [f]))

  const pedacos: string[] = []
  let atual = ''
  for (const frase of frases) {
    if (!atual) { atual = frase; continue }
    if (atual.length + 1 + frase.length <= teto) atual = `${atual} ${frase}`
    else { pedacos.push(atual); atual = frase }
  }
  if (atual) pedacos.push(atual)
  return pedacos
}
