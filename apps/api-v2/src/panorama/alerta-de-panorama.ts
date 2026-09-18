import type { Panorama } from './panorama.const'

/**
 * ── O buraco que isto fecha, medido em 17/09 ────────────────────────────────
 *
 * Quatro invariantes sondam a api V1: `historico_serve_conversa`, `telegram_responde`,
 * `memoria_relevante_serve_util` e `embeddings_respondem`. Quando ela não responde, os quatro
 * devolvem **`ok: true` com detalhe "Inconclusivo"** — e cada um está certo isoladamente: a casa
 * decidiu de propósito que inconclusivo não é falha, senão o sensor culparia o alvo errado.
 *
 * Somados, produzem o oposto do que se quer. Com a V1 fora e o Postgres de pé:
 *
 *   - os 4 que a sondam            → inconclusivo = ok
 *   - relógio, disco, redis, LLM   → verdes, não dependem dela
 *   - `projeto_ativo_no_catalogo`  → verde, lê o banco direto
 *
 * **18 de 18 verdes com a plataforma fora do ar** — a assinatura exata que o catálogo de
 * invariantes existe para não deixar acontecer.
 *
 * O `panorama` é a única coisa que mede `api_v1` diretamente. Faltava alguém olhar por ele.
 *
 * ── O que este alerta NÃO cobre, de propósito ───────────────────────────────
 *
 * **Invariantes ficam de fora.** O ciclo deles já empurra transição de gravidade `alta` por
 * projeto (`notificar-transicao.ts`). Repetir aqui mandaria duas mensagens para o mesmo fato — e
 * o modo pelo qual um alerta deixa de ser lido é exatamente esse.
 *
 * Fica de fora também o bloco `invariantes` quando vira `desconhecido`: isso significa que o ciclo
 * parou de gravar, e **o ciclo parado já aparece** como problema no bloco de ciclos
 * (`sem-noticia`). Um fato, um alerta.
 *
 * Então este mecanismo cobre só o que ninguém cobria: **serviços e ciclos.**
 */

export interface TransicaoDoPanorama {
  surgiram: string[]
  sumiram:  string[]
}

/** Prefixo para o que não pôde ser medido — `desconhecido` é condição de primeira classe aqui. */
export const NAO_MEDIDO = 'nao_medido:'

/**
 * O conjunto que vale alerta. Ids prefixados por bloco para não colidirem: um ciclo e um serviço
 * podem ter o mesmo nome (`api_v2` é serviço; um ciclo futuro pode repetir), e duas coisas
 * diferentes com a mesma chave é como uma some da conta.
 */
export function idsAlertaveis(p: Panorama): Set<string> {
  const ids = new Set<string>()

  for (const x of p.servicos.problemas) {
    if (x.gravidade === 'alta') ids.add(`servico:${x.id}`)
  }
  for (const x of p.ciclos.problemas) {
    if (x.gravidade === 'alta') ids.add(`ciclo:${x.id}`)
  }

  // Não ter conseguido medir é estado que esconde problema — vale aviso próprio.
  if (p.servicos.estado === 'desconhecido') ids.add(`${NAO_MEDIDO}servicos`)
  if (p.ciclos.estado   === 'desconhecido') ids.add(`${NAO_MEDIDO}ciclos`)

  return ids
}

/**
 * O que MUDOU. Sem conjunto anterior devolve vazio, pela mesma razão de `transicoesAltas`: a
 * primeira execução depois de subir anunciaria toda falha preexistente como recém-acontecida, e
 * um alerta que mente sobre QUANDO algo quebrou é pior que nenhum.
 */
export function transicaoDoPanorama(
  agora: Set<string>,
  anterior: Set<string> | null,
): TransicaoDoPanorama {
  if (!anterior) return { surgiram: [], sumiram: [] }

  return {
    surgiram: [...agora].filter((id) => !anterior.has(id)),
    sumiram:  [...anterior].filter((id) => !agora.has(id)),
  }
}

/** Rótulo legível — `servico:api_v1` no celular não diz nada a quem acordou com o aviso. */
function legivel(id: string, p: Panorama): string {
  if (id.startsWith(NAO_MEDIDO)) {
    const bloco = id.slice(NAO_MEDIDO.length)
    return `não foi possível medir ${bloco}`
  }
  const [bloco, resto] = [id.slice(0, id.indexOf(':')), id.slice(id.indexOf(':') + 1)]
  const lista = bloco === 'servico' ? p.servicos.problemas : p.ciclos.problemas
  const item  = lista.find((x) => x.id === resto)
  return item ? `${item.titulo}${item.detalhe ? ` — ${item.detalhe}` : ''}` : `${bloco} ${resto}`
}

/**
 * Mensagem curta. O Telegram não é o lugar do relatório, é o lugar do "olha isso" — mesma regra
 * de `textoDaTransicao`.
 *
 * A recuperação avisa também: sem ela, quem recebeu o alerta fica sem saber se ainda está
 * quebrado e vai abrir o painel, o que anula o ganho de ter sido avisado.
 */
export function textoDoPanorama(p: Panorama, t: TransicaoDoPanorama): string | null {
  if (!t.surgiram.length && !t.sumiram.length) return null

  const linhas: string[] = []

  for (const id of t.surgiram) {
    linhas.push(`🔴 ${legivel(id, p).slice(0, 300)}`)
  }

  if (t.sumiram.length) {
    // Na recuperação o item já não está na lista de problemas, então `legivel` não o acha —
    // o id cru é o que sobra, e é suficiente para "voltou".
    const nomes = t.sumiram.map((id) => id.replace(/^(servico|ciclo):/, '').replace(NAO_MEDIDO, ''))
    linhas.push(`🟢 voltou ao normal: ${nomes.join(', ')}`)
  }

  return [`*Sistema — ${p.resumo}*`, '', ...linhas].join('\n').trim()
}
