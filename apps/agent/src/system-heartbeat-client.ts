import axios from 'axios'

/**
 * Batimento do Guardian para `POST /v2/system/heartbeat`.
 *
 * Existe porque a análise do Guardian é **disparada por mudança, não por tick**:
 * `workspace-watcher` só chama `/v2/guardian/analyze` quando a assinatura de
 * arquivos muda. Três dias sem codar, zero chamadas — e não haveria como
 * distinguir "Guardian desligado" de "ninguém mexeu em código". Derivar vitalidade
 * do tráfego de análise reconstruiria a ambiguidade que o painel existe para
 * eliminar (ver o caso do `agent_audit_logs`, 2026-08-15).
 *
 * Frequência de batimento ≠ frequência de tick, de propósito: o watcher roda a
 * cada 30s, e bater junto seriam ~2.880 requisições/dia só para dizer "estou
 * aqui". A cada 5 min responde a mesma pergunta com 1/10 do tráfego.
 *
 * O que isto mede é **última notícia**, não "vivo". Como todo o produto do
 * Guardian trafega por este mesmo canal, silêncio aqui significa valor entregue
 * zero de qualquer forma — então a imprecisão é honesta.
 */

const BEAT_EVERY_MS = 5 * 60 * 1000

/**
 * Throttle POR COMPONENTE, não global.
 *
 * Era um `let ultimoBeat = 0` só, e funcionou enquanto havia um único batedor. Com o
 * segundo (`deploy-drift`), um throttle compartilhado faria os dois se calarem em
 * revezamento: quem batesse primeiro silenciaria o outro por 5 min, e o painel mostraria
 * "sem notícia" para um componente que está rodando — exatamente a ambiguidade que o
 * heartbeat existe para eliminar.
 */
const ultimoBeat = new Map<string, number>()

function v2BaseUrl(): string | null {
  if (process.env.AGENT_API_V2_URL) return process.env.AGENT_API_V2_URL.replace(/\/$/, '')
  try {
    const u = new URL(process.env.AGENT_API_URL ?? '')
    return `${u.protocol}//${u.hostname}:3103`
  } catch {
    return null
  }
}

/**
 * Bate se já passou o intervalo. Chamar a cada tick do watcher — o throttle
 * mora aqui, e não no chamador, para não haver dois lugares decidindo cadência.
 *
 * Nunca lança: contabilidade de saúde não pode derrubar o watcher que observa.
 */
export async function beatComponente(
  component: string,
  params: { ok: boolean; erro?: string; detalhe?: Record<string, unknown> },
): Promise<void> {
  const agora = Date.now()
  if (agora - (ultimoBeat.get(component) ?? 0) < BEAT_EVERY_MS) return

  const base = v2BaseUrl()
  if (!base) return

  try {
    await axios.post(
      `${base}/v2/system/heartbeat`,
      {
        component,
        ok:        params.ok,
        erro:      params.erro,
        detalhe:   params.detalhe,
        host:      process.env.COMPUTERNAME ?? process.env.HOSTNAME ?? 'desktop',
      },
      {
        headers: { Authorization: `Bearer ${process.env.AGENT_TOKEN}` },
        timeout: 5000,
      },
    )
    // Só marca depois do sucesso: se a rede caiu, tenta de novo no próximo tick
    // em vez de esperar mais 5 min.
    ultimoBeat.set(component, agora)
  } catch {
    /* sem rede é o proprio sinal — o painel mostra "sem noticia" */
  }
}

export async function beatGuardian(params: { ok: boolean; erro?: string; detalhe?: Record<string, unknown> }): Promise<void> {
  return beatComponente('guardian', params)
}

/** Só para teste: zera o throttle entre casos. */
export function _resetThrottle(): void {
  ultimoBeat.clear()
}
