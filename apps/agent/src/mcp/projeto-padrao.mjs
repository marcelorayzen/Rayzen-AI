/**
 * Quem pode cair no `MCP_PROJECT_ID` padrão numa LEITURA — item 7.5 (12/11).
 *
 * ── O caso que originou isto ─────────────────────────────────────────────────
 * No fio `rayzen-marcenaria` do Hub, o Hermes chamou `rayzen_get_state` com `{}`. O servidor caiu
 * no projeto padrão (Rayzen AI), anexou o `_warning` — e o modelo ignorou o aviso: respondeu no
 * fio da marcenaria descrevendo o trabalho em curso do Rayzen AI. A regra do plano do Hub diz que
 * a separação "precisa ser mecanismo de servidor, não uma instrução para o modelo"; o `_warning`
 * era instrução.
 *
 * ── Por que por consumidor, e não desligar o padrão ──────────────────────────
 * O mesmo `mcp-http` atende outros consumidores (o conector de leitura, sessões do Claude) para
 * os quais o padrão é conveniência conhecida e com aviso. O Hermes é diferente: fala em nome de um
 * FIO com projeto definido, então "sem projeto" nele é sempre engano, nunca atalho.
 *
 * ── Isto não é autorização ───────────────────────────────────────────────────
 * `identificarConsumidor()` continua sem decidir acesso (`escopoDoToken` decide). O nome aqui só
 * RETIRA uma conveniência — nunca concede ferramenta, escopo ou projeto. Um erro de nome deixa o
 * consumidor no comportamento antigo (padrão com aviso), nunca com acesso a mais.
 */

export const CONSUMIDORES_SEM_PROJETO_PADRAO = new Set(['hermes'])

/** As leituras que hoje caem no padrão via `resolveProjectIdLoud`. */
export const LEITURAS_COM_PROJETO_PADRAO = new Set([
  'rayzen_get_state',
  'rayzen_get_resume',
  'rayzen_get_events',
  'rayzen_search_memory',
  'rayzen_get_goal',
  'rayzen_get_context',
  'rayzen_list_specialists',
])

/** Mensagem de recusa, ou `null` quando a chamada segue o caminho de sempre. */
export function recusaPorFaltaDeProjeto(consumidor, ferramenta, args) {
  if (!consumidor || !CONSUMIDORES_SEM_PROJETO_PADRAO.has(consumidor)) return null
  if (!LEITURAS_COM_PROJETO_PADRAO.has(ferramenta)) return null
  const pid = args?.projectId
  if (typeof pid === 'string' && pid.trim()) return null
  return (
    `projectId obrigatório para "${ferramenta}" vindo de "${consumidor}": este consumidor fala em nome ` +
    'de um fio com projeto definido e não usa o projeto padrão do ambiente. Use o projectId do fio ' +
    '(informado no contexto do turno) ou, no escopo Geral, pergunte de qual projeto se trata.'
  )
}
