import { GRAVIDADE_ORDEM, InvariantResult } from './invariant-checks.const'

/**
 * ── Invariante que ninguém lê não avisa ─────────────────────────────────────
 *
 * Em 17/09 a conta da Jina ficou sem saldo e a memória semântica inteira saiu do ar. O invariante
 * `embeddings_respondem` ficou vermelho **corretamente** — e ninguém soube. A descoberta foi por
 * acaso, investigando um deploy que falhara no dia anterior por outro motivo.
 *
 * Os invariantes gravam em `v2.invariant_reports` e aparecem no painel e no contexto injetado pelo
 * hook. **Nada empurra para o celular.** O alerta que chegou ao Telegram naquele dia era do
 * `~/bin/rayzen-deploy.sh`, não do sensor.
 *
 * ── As duas restrições são o produto, não detalhes ──────────────────────────
 *
 * **Só na TRANSIÇÃO.** Um aviso a cada ciclo de 30 minutos vira ruído conhecido, e essa não é
 * teoria: em 16/09 o `disco_com_folga` avisou em 85, 86, 88, 90, 92 e 95% e cada aviso foi lido
 * como o anterior — até o disco encher e o Postgres entrar em laço de PANIC. Repetir o alerta é o
 * mecanismo pelo qual ele deixa de funcionar.
 *
 * **Só gravidade `alta`.** `registro_sem_projeto` é `media` e fica vermelho **por desenho** — ele
 * mede algo que acontece o tempo todo. Incluí-lo significaria alertar para sempre, que é a mesma
 * falha por outro caminho.
 *
 * A recuperação também avisa, e por um motivo prático: sem ela, quem recebeu o alerta fica sem
 * saber se ainda está quebrado, e vai olhar o painel — o que anula o ganho de ter sido avisado.
 */

/** Ids de gravidade `alta` que estão quebrados neste resultado. */
export function quebradosAltos(resultados: InvariantResult[]): Set<string> {
  return new Set(
    resultados
      .filter((r) => !r.ok && GRAVIDADE_ORDEM[r.gravidade] >= GRAVIDADE_ORDEM.alta)
      .map((r) => r.id),
  )
}

export interface Transicao {
  quebraram: InvariantResult[]
  voltaram:  string[]
}

/**
 * O que MUDOU entre o relatório anterior e agora, só para gravidade `alta`.
 *
 * Sem relatório anterior devolve vazio em vez de tratar tudo como novo: a primeira execução depois
 * de subir o serviço anunciaria toda falha preexistente como se tivesse acabado de acontecer, e um
 * alerta que mente sobre QUANDO algo quebrou é pior que nenhum.
 */
export function transicoesAltas(
  agora: InvariantResult[],
  anterior: InvariantResult[] | null,
): Transicao {
  if (!anterior) return { quebraram: [], voltaram: [] }

  const antes = quebradosAltos(anterior)
  const depois = quebradosAltos(agora)

  return {
    quebraram: agora.filter((r) => depois.has(r.id) && !antes.has(r.id)),
    voltaram:  [...antes].filter((id) => !depois.has(id)),
  }
}

/**
 * ── Notificar e GRAVAR são perguntas diferentes (corrigido 17/09) ───────────
 *
 * `transicoesAltas` restringe a `alta` de propósito, e essa restrição está certa **para o
 * celular**: `registro_sem_projeto` é `media` e fica vermelho por desenho, então incluí-lo
 * alertaria para sempre.
 *
 * Usar a MESMA restrição para decidir se o relatório é gravado foi meu erro, e ele apareceu na
 * primeira leitura real do `/v2/system/panorama`: o conserto do critério de órfãos entrou às
 * 21:44, o invariante ficou verde, e o painel continuou mostrando o problema — porque a última
 * linha gravada era de 21:28 e nada forçou uma nova. Sem falha e sem transição *alta*, a próxima
 * gravação só viria no heartbeat de 6h.
 *
 * O painel mostrava, com toda a honestidade do seu próprio desenho, **um estado que o sistema já
 * tinha deixado**.
 *
 * A razão para restringir o alerta (não treinar ninguém a ignorar) não é razão para restringir o
 * registro: o registro precisa ser verdadeiro. Então qualquer invariante que VIRE de estado força
 * a gravação, em qualquer gravidade — e continua não notificando se não for alta.
 */
export function mudouAlgumEstado(
  agora: InvariantResult[],
  anterior: InvariantResult[] | null,
): boolean {
  if (!anterior) return false

  const antes = new Map(anterior.map((r) => [r.id, r.ok]))
  return agora.some((r) => antes.has(r.id) && antes.get(r.id) !== r.ok)
}

/** Mensagem curta — o Telegram não é o lugar do relatório, é o lugar do "olha isso". */
export function textoDaTransicao(t: Transicao, projeto: string): string | null {
  if (t.quebraram.length === 0 && t.voltaram.length === 0) return null

  const linhas: string[] = []

  for (const r of t.quebraram) {
    linhas.push(`🔴 *${r.titulo}*`)
    linhas.push(r.detalhe.slice(0, 300))
    if (r.correcao) linhas.push(`_${r.correcao.slice(0, 300)}_`)
    linhas.push('')
  }

  if (t.voltaram.length > 0) linhas.push(`🟢 voltou ao normal: ${t.voltaram.join(', ')}`)

  return [`*Invariantes — ${projeto}*`, '', ...linhas].join('\n').trim()
}

/**
 * Fala com a API do Telegram DIRETO, nunca pela api V1.
 *
 * É a mesma decisão do `avisar()` do deploy, e aqui ela é ainda mais necessária: vários destes
 * sensores medem justamente a api V1 (`telegram_responde`, `historico_serve_conversa`,
 * `embeddings_respondem` sondam endpoints dela). Mandar o alerta por ela seria pedir que o
 * serviço caído anunciasse a própria queda.
 *
 * Falha em silêncio de propósito: não conseguir avisar não pode derrubar o ciclo de invariantes,
 * que é a coisa que ainda está funcionando.
 */
export async function enviarAoTelegram(texto: string): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN
  const chat  = process.env.TELEGRAM_CHAT_ID
  if (!token || !chat) return false

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ chat_id: chat, text: texto.slice(0, 4096), parse_mode: 'Markdown' }),
      signal:  AbortSignal.timeout(15_000),
    })
    return res.ok
  } catch {
    return false
  }
}
