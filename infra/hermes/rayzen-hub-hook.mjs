#!/usr/bin/env node
/**
 * ── O HUB deixa de ser um cérebro à parte ───────────────────────────────────
 *
 * Até 18/09 a conversa do HUB vivia só no `state.db` do Hermes: não existia em
 * `conversation_messages`, não entrava na busca, não aparecia no histórico. Perguntar depois "o
 * que a gente combinou?" não tinha resposta.
 *
 * Este hook é o mesmo padrão que esta casa já roda para o Claude Code (`rayzen-hook.mjs`:
 * `PostToolUse`/`Stop` → `POST /events/cli`). Simetria, não invenção.
 *
 * ── Por que hook e não ferramentas de escrita por MCP ───────────────────────
 *
 * Porque aqui **quem emite é o runtime, não o modelo**. `post_llm_call` dispara uma vez por turno,
 * depois do laço de ferramentas, e o próprio Hermes já exclui trabalho interno ("detached forks
 * are internal work and must not publish turns under the parent's session ID").
 *
 * Dar ferramentas de escrita faria o registro ser o que o modelo ACHOU que valia guardar. A casa
 * tem evidência de sobra do que isso produz: da personality antiga saíram um `decision_log.db`, um
 * watchdog de `buildkitd` que não existe e uma branch `release/R3.b` que nunca existiu. E o HUB
 * está exposto na internet desde 18/09 — token de escrita ali é outro risco.
 *
 * ── Contrato ────────────────────────────────────────────────────────────────
 *
 * Entra JSON no stdin: `{ hook_event_name, session_id, cwd, profile, extra: { ... } }`.
 * `user_message` e `assistant_response` chegam em `extra` porque não são campos de topo.
 *
 * **Nunca falha ruidosamente e nunca bloqueia**: sai 0 em qualquer erro. Um hook que derruba o
 * turno trocaria "a conversa não é registrada" por "a conversa não acontece".
 */

const URL_BASE = (process.env.RAYZEN_API_URL || 'http://api:3001').replace(/\/$/, '')
const TOKEN    = process.env.HUB_INGEST_TOKEN || ''
const PROJETO  = process.env.RAYZEN_PROJECT_ID || ''
const TIMEOUT  = 5000

function sair(motivo) {
  if (motivo) process.stderr.write(`[rayzen-hub-hook] ${motivo}\n`)
  process.exit(0)
}

async function principal() {
  if (!TOKEN) return sair('HUB_INGEST_TOKEN ausente — turno nao registrado')

  const bruto = await new Promise((resolve) => {
    let dados = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (c) => { dados += c })
    process.stdin.on('end', () => resolve(dados))
    process.stdin.on('error', () => resolve(''))
  })

  let payload
  try { payload = JSON.parse(bruto || '{}') } catch { return sair('payload nao e JSON') }

  const extra = payload.extra || {}
  const corpo = {
    sessionId:         payload.session_id || '',
    userMessage:       typeof extra.user_message === 'string' ? extra.user_message : '',
    assistantResponse: typeof extra.assistant_response === 'string' ? extra.assistant_response : '',
    model:             typeof extra.model === 'string' ? extra.model : null,
    ...(PROJETO ? { projectId: PROJETO } : {}),
  }

  // `conversation_history` NAO e enviado de proposito: ele carrega o turno inteiro a cada
  // disparo, entao mandar tudo cresceria quadraticamente e reescreveria o mesmo texto N vezes.
  if (!corpo.sessionId) return sair('sem session_id')
  if (!corpo.userMessage && !corpo.assistantResponse) return sair('turno vazio')

  try {
    const ctrl = new AbortController()
    const t    = setTimeout(() => ctrl.abort(), TIMEOUT)
    const res  = await fetch(`${URL_BASE}/sessions/ingest`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
      body:    JSON.stringify(corpo),
      signal:  ctrl.signal,
    })
    clearTimeout(t)
    if (!res.ok) return sair(`ingestao respondeu HTTP ${res.status}`)
  } catch (e) {
    return sair(`ingestao falhou: ${e && e.message ? e.message : e}`)
  }
  process.exit(0)
}

principal().catch((e) => sair(`erro inesperado: ${e && e.message ? e.message : e}`))
