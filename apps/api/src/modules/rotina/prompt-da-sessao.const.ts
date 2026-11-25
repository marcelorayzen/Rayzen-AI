/**
 * G6, fatia 3 (21/11) — o prompt da sessão que uma rotina propõe é montado pela MESMA regra da
 * proposta pelo Hub (`apps/agent/src/mcp/proposta-de-sessao.mjs`, G4.2): Objetivo, Restrições,
 * Critério de pronto e, opcional, Detalhes, nessa ordem e nesse formato.
 *
 * Cópia consciente, com teste anti-drift (`__tests__/prompt-da-sessao.spec.ts` roda o `.mjs` real e
 * compara a saída): o `.mjs` é ESM e vive no agent, e a api é CommonJS em outra imagem — o mesmo
 * motivo de `event-derived-text.const.ts` existir nas duas apps.
 */
export function montarPromptDaSessao(args: {
  objetivo?: unknown
  restricoes?: unknown
  criterioDePronto?: unknown
  prompt?: unknown
}): { prompt: string; problemas: string[] } {
  const texto = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
  const objetivo = texto(args?.objetivo)
  const restricoes = texto(args?.restricoes)
  const criterioDePronto = texto(args?.criterioDePronto)
  const detalhes = texto(args?.prompt)

  const problemas: string[] = []
  if (objetivo.length < 10) problemas.push('objetivo precisa dizer o que deve existir ao fim')
  if (restricoes.length < 3) {
    problemas.push('restricoes precisa dizer o que não mexer e os limites (escreva "nenhuma além do AGENTS.md" se for o caso)')
  }
  if (criterioDePronto.length < 10) {
    problemas.push('criterioDePronto precisa dizer como verificar que terminou (teste, comando, o que conferir)')
  }

  const partes = [
    `Objetivo:\n${objetivo}`,
    `Restrições:\n${restricoes}`,
    `Critério de pronto (como verificar):\n${criterioDePronto}`,
  ]
  if (detalhes) partes.push(`Detalhes:\n${detalhes}`)
  return { prompt: partes.join('\n\n'), problemas }
}

/**
 * Valor que pode entrar num marcador: só o que é estrutural (número, nome de ramo, SHA, nome de
 * repositório, URL do GitHub). Ramo e nome de workflow são escritos por quem abriu o PR, então
 * mesmo eles passam por esta lista de caracteres — nada de espaço, nada de frase. É o "nunca texto
 * escrito por terceiros" do desenho, aplicado no ponto em que o texto entra no prompt.
 */
const VALOR_ESTRUTURAL = /^[A-Za-z0-9._\-/#:]{1,200}$/

export const VALOR_RECUSADO = '[valor recusado]'

/**
 * Troca `{{nome}}` pelos valores estruturados do disparo. Marcador sem valor, ou com valor fora da
 * forma estrutural, vira `[valor recusado]` e entra em `recusados` — o envelope sai dizendo o que
 * faltou, em vez de sair com o marcador cru ou com texto de terceiro.
 */
export function preencherMarcadores(
  modelo: string,
  valores: Record<string, string | number | undefined>,
): { texto: string; recusados: string[] } {
  const recusados: string[] = []
  const texto = modelo.replace(/\{\{\s*([a-zA-Z][\w.]*)\s*\}\}/g, (_inteiro, nome: string) => {
    const bruto = valores[nome]
    const valor = bruto === undefined ? '' : String(bruto)
    if (!VALOR_ESTRUTURAL.test(valor)) {
      recusados.push(nome)
      return VALOR_RECUSADO
    }
    return valor
  })
  return { texto, recusados }
}
