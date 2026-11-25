// G4.2 (20/11) — o prompt da sessão é montado pelo servidor a partir de campos, não redigido livre.
//
// Até aqui `rayzen_propose_session` recebia um `prompt` de texto livre e exigia 20 caracteres.
// Objetivo, restrições e critério de pronto só chegavam ao trabalhador se o modelo do Hub
// lembrasse de escrevê-los (medido em 20/11: os prompts recentes vinham bem escritos, mas por
// disciplina do modelo, não por contrato). Agora os três são campos obrigatórios e a forma do
// prompt é fixa; o texto livre continua, opcional, como "Detalhes".
//
// Módulo puro e separado do servidor de propósito: `rayzen-mcp-http.mjs` abre um servidor HTTP ao
// ser importado, então só dá para testar este pedaço de verdade se ele morar fora.

const MINIMOS = { objetivo: 10, restricoes: 3, criterioDePronto: 10 }

const texto = (v) => (typeof v === 'string' ? v.trim() : '')

/** Devolve `{ prompt, problemas }`. `problemas` vazio = prompt pronto para o envelope. */
export function montarPromptDaSessao(args) {
  const objetivo = texto(args?.objetivo)
  const restricoes = texto(args?.restricoes)
  const criterioDePronto = texto(args?.criterioDePronto)
  const detalhes = texto(args?.prompt)

  const problemas = []
  if (objetivo.length < MINIMOS.objetivo) problemas.push('objetivo precisa dizer o que deve existir ao fim')
  if (restricoes.length < MINIMOS.restricoes) {
    problemas.push('restricoes precisa dizer o que não mexer e os limites (escreva "nenhuma além do AGENTS.md" se for o caso)')
  }
  if (criterioDePronto.length < MINIMOS.criterioDePronto) {
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
