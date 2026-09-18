/**
 * Batimento de um ciclo da **V1** no painel de sistema, que vive na V2.
 *
 * Existe porque o `SmartCheckpointService` — o **maior consumidor de LLM da
 * plataforma** — não aparecia em painel nenhum. Se parasse, ninguém saberia: mesmo
 * silêncio que deixou o agent desktop 28h fora em 2026-09-05.
 *
 * ## Por que HTTP e não escrever na tabela
 *
 * `v2.system_heartbeats` é da V2. A regra do monorepo é que a V2 **lê** o schema
 * `public` e nunca escreve; a V1 escrever no schema `v2` seria a mesma violação na
 * direção mais forte, e criaria uma segunda fonte de verdade para o painel.
 * `POST /v2/system/heartbeat` já existe e já é usado pelo agent desktop — este é o
 * segundo cliente do mesmo contrato, não um caminho novo.
 *
 * O endpoint recusa `component` fora do `system-components.const.ts`, então um id
 * errado falha na hora em vez de criar linha órfã.
 *
 * **Nunca lança.** Contabilidade de saúde não pode derrubar o ciclo que ela observa —
 * e falha de rede aqui já é o próprio sinal: o painel mostra "sem notícia".
 */
export async function baterNaV2(
  component: string,
  params: { ok: boolean; erro?: string; detalhe?: Record<string, unknown> },
): Promise<void> {
  // Mesmo default do `infra-health.service.ts`. Em produção o compose injeta
  // `API_V2_URL: http://api-v2:3002` — porta INTERNA, não a 3103 publicada no host.
  const base = (process.env.API_V2_URL ?? 'http://localhost:3103').replace(/\/$/, '')

  try {
    await fetch(`${base}/v2/system/heartbeat`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        component,
        ok:      params.ok,
        erro:    params.erro,
        detalhe: params.detalhe,
        host:    'api',
      }),
      signal: AbortSignal.timeout(5000),
    })
  } catch {
    /* sem rede é o próprio sinal — o painel mostra "sem noticia" */
  }
}
