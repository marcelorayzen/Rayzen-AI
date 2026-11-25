// G6, fatia 6 (21/11) — o que um evento do GitHub entrega às rotinas.
//
// Rota e segredo próprios (`/webhook/github-rotinas`, `GITHUB_ROTINAS_WEBHOOK_SECRET`), separados do
// deploy: o repositório de um projeto configurado para rotinas nunca alcança o deploy do Rayzen, e o
// segredo de um não abre o outro (ver docs/decisions/G6-rotinas-desenho.md).
//
// Daqui só saem CAMPOS ESTRUTURADOS: repositório, número do PR, ramo, SHA, nome do workflow, URL.
// Título e corpo do PR, mensagem de commit e log do CI ficam de fora — são texto escrito por
// terceiros, e é por eles que uma instrução escondida chegaria ao modelo. Mesmo os campos que
// saem passam de novo pela forma estrutural na api, antes de virar marcador.
//
// Módulo puro e separado do servidor de propósito, como `webhook-deploy.mjs`.

const texto = (v) => (typeof v === 'string' ? v : undefined)
const numero = (v) => (Number.isInteger(v) && v > 0 ? v : undefined)

/**
 * Devolve o evento estruturado para a api, ou `null` quando o evento não interessa às rotinas.
 * Só dois eventos existem na v1: PR aberto e workflow concluído com falha.
 */
export function extrairEventoDeRotina(evento, payload) {
  const repo = texto(payload?.repository?.full_name)
  if (!repo) return null

  // 21/11: repositório PÚBLICO aceita PR de qualquer um. Código vindo de fork é de terceiro por
  // definição, então nem segue para a api; e o autor do evento vai junto, para a api exigir que seja
  // um dos donos permitidos (decisão 4 do desenho, que falava do repositório e não de quem abriu).
  if (evento === 'pull_request' && payload?.action === 'opened') {
    const pr = payload.pull_request ?? {}
    if (texto(pr.head?.repo?.full_name) !== repo) return null
    return limpar({
      evento: 'pull_request.opened',
      repo,
      autor: texto(pr.user?.login),
      numero: numero(pr.number),
      ramo: texto(pr.head?.ref),
      sha: texto(pr.head?.sha),
      url: texto(pr.html_url),
    })
  }

  if (evento === 'workflow_run' && payload?.action === 'completed' && payload?.workflow_run?.conclusion === 'failure') {
    const run = payload.workflow_run
    if (texto(run.head_repository?.full_name) !== repo) return null
    return limpar({
      evento: 'workflow_run.failure',
      repo,
      autor: texto(run.triggering_actor?.login) ?? texto(run.actor?.login),
      numero: numero(run.pull_requests?.[0]?.number),
      ramo: texto(run.head_branch),
      sha: texto(run.head_sha),
      workflow: texto(run.name),
      url: texto(run.html_url),
    })
  }

  return null
}

/** Tira as chaves sem valor, para a api não receber `undefined` como campo. */
function limpar(objeto) {
  return Object.fromEntries(Object.entries(objeto).filter(([, v]) => v !== undefined))
}
