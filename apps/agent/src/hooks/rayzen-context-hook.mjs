#!/usr/bin/env node
/**
 * Rayzen AI — UserPromptSubmit hook (inteligente)
 *
 * Antes do Claude pensar:
 *   1. Lê o texto da mensagem do usuário
 *   2. Classifica a intenção (debugging / implementation / architecture / review / study)
 *   3. Resolve o projeto pelo git remote (qualquer projeto no Rayzen, não só rayzen-ai)
 *   4. Chama o context-engine (/v2/context/build) com mode + query
 *   5. Injeta contexto cirúrgico como additionalContext
 *
 * Benefício: Claude já começa com o contexto certo — zero chamadas MCP manuais,
 * zero tokens gastos em re-derivação do estado.
 *
 * Budget: deve terminar em < 2.5s. Tem fallback para /projects/:id/state se o
 * context-engine demorar ou falhar.
 */

import { request } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'
import { execSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'

const TIMING_FILE = join(tmpdir(), 'rayzen-ctx-timing.json')

function writeTimingFile(data) {
  try {
    writeFileSync(TIMING_FILE, JSON.stringify({ ...data, ts: Date.now() }), 'utf8')
  } catch { /* ignora */ }
}

const __dir = dirname(fileURLToPath(import.meta.url))
const CONFIG_PATH = join(__dir, 'hook.config.mjs')

// Cache cirúrgico: TTL menor (3 min) pois varia por intenção
const CTX_CACHE_TTL  = 3 * 60 * 1000
const CTX_CACHE_FILE = join(tmpdir(), 'rayzen-ctx-smart-cache.json')

// ── Configuração ─────────────────────────────────────────────────────────────

async function loadConfig() {
  let cfg = {}
  if (existsSync(CONFIG_PATH)) {
    try {
      const url = new URL(`file:///${CONFIG_PATH.replace(/\\/g, '/')}`)
      const mod = await import(url.href)
      cfg = mod.default ?? {}
    } catch { /* ignora */ }
  }
  return {
    apiUrl:    process.env.RAYZEN_API_URL    ?? cfg.apiUrl    ?? 'http://localhost:3001',
    apiToken:  process.env.RAYZEN_API_TOKEN  ?? cfg.apiToken  ?? '',
    projectId: process.env.RAYZEN_PROJECT_ID ?? cfg.projectId ?? '',
    // URL base da V2 (context-engine) — padrão: mesma host, porta 3103
    apiV2Url:  process.env.RAYZEN_API_V2_URL ?? cfg.apiV2Url  ?? null,
  }
}

// ── Leitura do prompt ─────────────────────────────────────────────────────────

async function readStdin() {
  return new Promise((resolve) => {
    let data = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', chunk => { data += chunk })
    process.stdin.on('end', () => resolve(data))
    // Timeout apertado — não pode bloquear o prompt
    setTimeout(() => resolve(data), 800)
  })
}

function extractPromptText(raw) {
  try {
    const payload = JSON.parse(raw)
    // UserPromptSubmit: { prompt: string } ou { message: string }
    return payload.prompt ?? payload.message ?? ''
  } catch {
    return raw.slice(0, 500)
  }
}

// ── Classificação de intenção ─────────────────────────────────────────────────

function classifyIntent(text) {
  const t = text.toLowerCase()
  if (/erro|quebrou|n[aã]o funciona|falhou|bug|exception|crash|500|401|404|problema|issue/.test(t))
    return 'debugging'
  if (/arquitetura|design|estrutura|plano|reorganiz|refator|decisão|decisao|como design/.test(t))
    return 'architecture'
  if (/review|revisar|checar|analis|auditar|verificar|código certo|ta certo/.test(t))
    return 'review'
  if (/como funciona|explica|o que [eé]|entender|estudar|aprender|o que faz/.test(t))
    return 'study'
  return 'implementation'
}

// Query semântica: primeiros 200 chars, sem ruído de formatação
function extractQuery(text) {
  return text.replace(/```[\s\S]*?```/g, '').replace(/\s+/g, ' ').trim().slice(0, 200)
}

// ── Cache ─────────────────────────────────────────────────────────────────────

function cacheKey(projectId, mode, query) {
  return createHash('md5').update(`${projectId}:${mode}:${query}`).digest('hex').slice(0, 8)
}

function readCache(key) {
  try {
    const c = JSON.parse(readFileSync(CTX_CACHE_FILE, 'utf8'))
    if (c.key === key && Date.now() - c.ts < CTX_CACHE_TTL) return c.context
  } catch { /* ignora */ }
  return null
}

function writeCache(key, context) {
  try {
    writeFileSync(CTX_CACHE_FILE, JSON.stringify({ key, context, ts: Date.now() }), 'utf8')
  } catch { /* ignora */ }
}

// ── HTTP ──────────────────────────────────────────────────────────────────────

function httpGet(url, token, timeoutMs = 2000) {
  return new Promise((resolve) => {
    const parsed = new URL(url)
    const lib    = parsed.protocol === 'https:' ? httpsRequest : request
    const req    = lib({
      hostname: parsed.hostname,
      port:     parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path:     parsed.pathname + parsed.search,
      method:   'GET',
      headers:  { Authorization: `Bearer ${token}` },
    }, (res) => {
      let body = ''
      res.on('data', d => { body += d })
      res.on('end', () => { try { resolve(JSON.parse(body)) } catch { resolve(null) } })
    })
    req.on('error', () => resolve(null))
    req.setTimeout(timeoutMs, () => { req.destroy(); resolve(null) })
    req.end()
  })
}

function httpPost(url, body, token, timeoutMs = 2000) {
  return new Promise((resolve) => {
    const parsed  = new URL(url)
    const lib     = parsed.protocol === 'https:' ? httpsRequest : request
    const payload = JSON.stringify(body)
    const req     = lib({
      hostname: parsed.hostname,
      port:     parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path:     parsed.pathname + parsed.search,
      method:   'POST',
      headers:  {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(payload),
        Authorization:    `Bearer ${token}`,
      },
    }, (res) => {
      let b = ''
      res.on('data', d => { b += d })
      res.on('end', () => { try { resolve(JSON.parse(b)) } catch { resolve(null) } })
    })
    req.on('error', () => resolve(null))
    req.setTimeout(timeoutMs, () => { req.destroy(); resolve(null) })
    req.write(payload)
    req.end()
  })
}

// ── Resolução de projeto ──────────────────────────────────────────────────────

const SLUG_CACHE_FILE = join(tmpdir(), 'rayzen-slug-cache.json')
const SLUG_CACHE_TTL  = 5 * 60 * 1000

function getProjectName() {
  try {
    const remote = execSync('git remote get-url origin', { encoding: 'utf8', timeout: 1500, stdio: ['pipe','pipe','ignore'] }).trim()
    const m = remote.match(/\/([^/]+?)(?:\.git)?$/)
    if (m?.[1]) return m[1]
  } catch { /* sem remote */ }
  try {
    const root = execSync('git rev-parse --show-toplevel', { encoding: 'utf8', timeout: 1500, stdio: ['pipe','pipe','ignore'] }).trim()
    return root.split(/[\\/]/).pop() ?? null
  } catch { return null }
}

function readSlugCache(slug) {
  try {
    const c = JSON.parse(readFileSync(SLUG_CACHE_FILE, 'utf8'))
    if (c.slug === slug && Date.now() - c.ts < SLUG_CACHE_TTL) return c.projectId
  } catch { /* ignora */ }
  return null
}

function writeSlugCache(slug, projectId) {
  try { writeFileSync(SLUG_CACHE_FILE, JSON.stringify({ slug, projectId, ts: Date.now() }), 'utf8') } catch { /* ignora */ }
}

async function resolveProjectId(cfg) {
  if (cfg.projectId) return cfg.projectId

  const slug = getProjectName()
  if (!slug) return null

  const cached = readSlugCache(slug)
  if (cached) return cached

  const projects = await httpGet(`${cfg.apiUrl}/projects?repoSlug=${encodeURIComponent(slug)}`, cfg.apiToken, 1500)
  const id = Array.isArray(projects) && projects.length > 0 ? projects[0].id : null
  if (id) { writeSlugCache(slug, id); return id }

  // Stale fallback
  try {
    const stale = JSON.parse(readFileSync(SLUG_CACHE_FILE, 'utf8'))
    if (stale.slug === slug) return stale.projectId
  } catch { /* ignora */ }
  return null
}

// ── Formatar contexto ─────────────────────────────────────────────────────────

function formatContextEngine(data, mode) {
  if (!data?.sections) return null
  const s = data.sections
  const lines = [`### Rayzen — contexto [${mode}]`]

  if (s.project_state) lines.push(s.project_state)
  if (s.active_goal)   lines.push(`\n**Meta:** ${s.active_goal.split('\n')[0].replace('Goal: ', '')}`)
  if (s.blockers && s.blockers !== 'No active blockers.') lines.push(`**Blocker:** ${s.blockers}`)

  if (s.memory_relevant) {
    lines.push('\n**Memória relevante:**')
    lines.push(s.memory_relevant.slice(0, 800))
  }

  if (s.planning) {
    const nextSteps = s.planning.match(/Next steps:([\s\S]*?)(?:\n\n|$)/)?.[1]
    if (nextSteps) lines.push(`\n**Próximos passos:**${nextSteps.slice(0, 300)}`)
  }

  if (s.recent_events) {
    lines.push('\n**Atividade recente:**')
    lines.push(s.recent_events.slice(0, 600))
  }

  if (s.knowledge_graph) {
    lines.push('\n**Knowledge graph:**')
    lines.push(s.knowledge_graph.slice(0, 600))
  }

  if (s.policy_constraints && s.policy_constraints !== 'No active policy constraints.') {
    lines.push('\n**Políticas ativas:**')
    lines.push(s.policy_constraints.slice(0, 400))
  }

  if (s.approval_gates) {
    lines.push('\n**Gates pendentes:**')
    lines.push(s.approval_gates.slice(0, 400))
  }

  lines.push('\n_(contexto cirúrgico injetado pelo hook — mode: ' + mode + ')_')
  return lines.join('\n')
}

function formatStateFallback(state) {
  if (!state) return null
  const lines = ['### Rayzen — estado do projeto']
  if (state.objective) lines.push(`**Objetivo:** ${state.objective}`)
  if (state.stage)     lines.push(`**Stage:** ${state.stage}`)
  const blockers = (state.blockers ?? [])
    .map((b) => typeof b === 'string' ? b : (b.description ?? b.title ?? b.text ?? '').toString())
    .filter(Boolean)
  if (blockers.length) lines.push(`**Blockers:** ${blockers.join(' · ')}`)
  const steps = (state.nextSteps ?? []).slice(0, 3)
  if (steps.length) {
    lines.push('**Próximos passos:**')
    steps.forEach(s => lines.push(`  - ${typeof s === 'string' ? s : (s.title ?? '')}`))
  }
  lines.push('_(estado básico — context-engine indisponível)_')
  return lines.join('\n')
}

// ── Formatar missão ativa ─────────────────────────────────────────────────────

function formatActiveMission(mission) {
  if (!mission) return null
  const steps = (mission.steps ?? [])
  const pendingSteps = steps.filter((s) => s.status === 'pending' || s.status === 'running')
  const doneCount    = steps.filter((s) => s.status === 'done' || s.status === 'skipped').length

  const lines = [
    `\n### Missão ${mission.status === 'active' ? 'ativa' : 'pendente'}`,
    `**${mission.title}**`,
    `Objetivo: ${mission.objective}`,
    `Status: ${mission.status} · ${doneCount}/${steps.length} steps concluídos`,
  ]

  if (pendingSteps.length > 0) {
    lines.push('**Próximos steps:**')
    pendingSteps.slice(0, 4).forEach((s) => {
      lines.push(`  - [${s.status}] ${s.title}${s.executor ? ` (${s.executor})` : ''}`)
    })
  }

  lines.push(`ID: \`${mission.id}\` — para completar: POST /v2/missions/${mission.id}/complete`)
  return lines.join('\n')
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const t0 = Date.now()
  const [raw, cfg] = await Promise.all([readStdin(), loadConfig()])
  if (!cfg.apiToken) process.exit(0)

  const promptText = extractPromptText(raw)
  const mode       = classifyIntent(promptText)
  const query      = extractQuery(promptText) || 'estado atual do projeto'

  const projectId = await resolveProjectId(cfg)
  if (!projectId) process.exit(0)

  // Cache cirúrgico por intenção
  const key    = cacheKey(projectId, mode, query)
  const cached = readCache(key)

  // Derivar URL da V2 a partir da V1 (mesma host, porta 3103)
  const v2Base = cfg.apiV2Url ?? (() => {
    try {
      const u = new URL(cfg.apiUrl)
      u.port  = '3103'
      u.pathname = ''
      return u.origin
    } catch { return null }
  })()

  // Missão ativa — sempre fresca (sem cache), paralelo com o contexto
  const missionPromise = v2Base
    ? httpGet(`${v2Base}/v2/missions/next-pending?projectId=${encodeURIComponent(projectId)}`, cfg.apiToken, 1000)
    : Promise.resolve(null)

  if (cached) {
    const mission = await missionPromise
    const missionBlock = formatActiveMission(mission)
    const full = missionBlock ? `${cached}${missionBlock}` : cached
    writeTimingFile({ hookDurationMs: Date.now() - t0, cacheHit: true, mode, projectId })
    console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: full } }))
    process.exit(0)
  }

  let context = null
  let ceMs = 0

  // Tentativa principal: context-engine V2
  if (v2Base) {
    const t1 = Date.now()
    const data = await httpPost(
      `${v2Base}/v2/context/build`,
      { projectId, mode, query, maxTokens: 1200 },
      cfg.apiToken,
      2200,
    )
    ceMs = Date.now() - t1
    context = formatContextEngine(data, mode)
  }

  // Fallback: /projects/:id/state (V1)
  if (!context) {
    const state = await httpGet(`${cfg.apiUrl}/projects/${projectId}/state`, cfg.apiToken, 1500)
    context = formatStateFallback(state)
  }

  if (!context) process.exit(0)

  writeCache(key, context)

  // Append missão ativa (já em paralelo desde o início)
  const mission = await missionPromise
  const missionBlock = formatActiveMission(mission)
  const full = missionBlock ? `${context}${missionBlock}` : context

  writeTimingFile({ hookDurationMs: Date.now() - t0, contextEngineDurationMs: ceMs || null, cacheHit: false, mode, projectId })
  console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: full } }))
  process.exit(0)
}

main().catch(() => process.exit(0))
