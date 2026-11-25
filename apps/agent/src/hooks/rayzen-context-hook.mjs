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
import { candidatosDeSlug } from '../repo-slug.mjs'

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

/** `cwd` do payload — sempre presente segundo a doc dos hooks. */
function extractCwd(raw) {
  try { return JSON.parse(raw).cwd ?? undefined } catch { return undefined }
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

// Resolução do slug: `../repo-slug.mjs`, fonte única compartilhada com o
// rayzen-hook e o MCP. Divergir aqui faz contexto e evento apontarem para
// projetos diferentes no mesmo diretório.

/** O repoSlug REGISTRADO do último projeto resolvido — não a grafia que casou. */
function readSlugCacheReal() {
  try { return JSON.parse(readFileSync(SLUG_CACHE_FILE, 'utf8')).repoSlugReal ?? null } catch { return null }
}

function readSlugCache(slug) {
  try {
    const c = JSON.parse(readFileSync(SLUG_CACHE_FILE, 'utf8'))
    if (c.slug === slug && Date.now() - c.ts < SLUG_CACHE_TTL) return c.projectId
  } catch { /* ignora */ }
  return null
}

function writeSlugCache(slug, projectId, repoSlugReal) {
  try { writeFileSync(SLUG_CACHE_FILE, JSON.stringify({ slug, projectId, repoSlugReal, ts: Date.now() }), 'utf8') } catch { /* ignora */ }
}

async function resolveProjectId(cfg, cwd) {
  if (cfg.projectId) return cfg.projectId

  // `cwd` vem do PAYLOAD, não de `process.cwd()` — ver a nota em `rayzen-hook.mjs`.
  // A doc do Claude Code garante o campo em todo evento, e ele é o que segue o Claude
  // em worktree e depois de `cd`.
  const candidatos = candidatosDeSlug(cwd)
  if (candidatos.length === 0) return null

  for (const slug of candidatos) {
    const cached = readSlugCache(slug)
    if (cached) { cfg.repoSlug = readSlugCacheReal() ?? slug; return cached }
  }

  for (const slug of candidatos) {
    const projects = await httpGet(`${cfg.apiUrl}/projects?repoSlug=${encodeURIComponent(slug)}`, cfg.apiToken, 1500)
    const achado = Array.isArray(projects) && projects.length > 0 ? projects[0] : null
    const id = achado?.id ?? null
    // Emite o repoSlug REGISTRADO, não a grafia que casou. São duas candidatas em ordem
    // (crua antes de kebab) e a busca aceita a que não é a oficial: aqui o diretório
    // `rayzen-ai` resolve um projeto cujo repoSlug é `rayzen-ai-private`. Publicar a
    // candidata faria a identidade injetada afirmar um slug que o Rayzen não conhece.
    if (id) {
      const real = achado?.repoSlug ?? slug
      cfg.repoSlug = real
      writeSlugCache(slug, id, real)
      return id
    }
  }

  // Stale fallback
  try {
    const stale = JSON.parse(readFileSync(SLUG_CACHE_FILE, 'utf8'))
    if (candidatos.includes(stale.slug)) { cfg.repoSlug = stale.slug; return stale.projectId }
  } catch { /* ignora */ }
  return null
}

/**
 * Como ENDEREÇAR o projeto — o que o hook já resolveu e jogava fora.
 *
 * Todo o resto do contexto é semântico: objetivo, memória, eventos, políticas. Nada
 * dizia o `projectId`, o `repoSlug` ou a URL da API — e o hook tem os três na mão,
 * porque acabou de usá-los para buscar tudo que injeta.
 *
 * Medido em 2026-09-05, numa sessão real: **~10 chamadas gastas só redescobrindo**
 * UUID do projeto, rota da meta (depois de um 404), formato dos critérios, schema
 * `v2` vs `public` e nomes de coluna. Toda manhã, em toda sessão nova, de novo.
 *
 * O token NÃO entra aqui — só onde ele mora. Segredo em contexto injetado vira
 * segredo em transcript, em log e em qualquer lugar que o prompt for parar.
 */
function formatarIdentidade(cfg, projectId, v2Base) {
  if (!projectId) return null
  const linhas = [
    '### Rayzen — identidade',
    `projectId: \`${projectId}\``,
  ]
  if (cfg.repoSlug) linhas.push(`repoSlug: \`${cfg.repoSlug}\``)
  if (cfg.apiUrl)   linhas.push(`api V1: ${cfg.apiUrl}`)
  if (v2Base)       linhas.push(`api V2: ${v2Base}/v2`)
  const agent = avisoAgentParado()
  if (agent) linhas.push(agent)
  return linhas.join('\n') + '\n\n'
}

/** Ticks do watcher que podem faltar antes de valer a pena avisar. */
const VIVO_TOLERANCIA_MS = 5 * 60 * 1000

/**
 * Avisa quando o agent desktop não está de pé — e fica **calado** quando está.
 *
 * O agent não é opcional para o que este hook promete: sem ele param o
 * workspace-watcher (edições fora do Claude Code), o Guardian e o disparo de
 * invariantes. Só que a ausência não muda nada visível — os blocos do Guardian e
 * dos invariantes simplesmente não aparecem, exatamente como quando está tudo bem.
 *
 * Medido em 2026-09-06: **28h sem batimento** depois de um reboot, e a descoberta
 * foi por acaso. É a mesma família do estado velho do ProjectState — *ausente se
 * percebe, velho não* —, com um agravante: aqui a ausência do sinal era
 * indistinguível de "não há nada a reportar".
 *
 * Calado abaixo da tolerância pelo mesmo motivo dos invariantes: um aviso em todo
 * prompt treina a ignorar o aviso.
 */
function avisoAgentParado() {
  let em = null
  try {
    em = JSON.parse(readFileSync(join(tmpdir(), 'rayzen-agent-vivo.json'), 'utf8')).em ?? null
  } catch { /* arquivo ausente é o próprio sinal — trata como parado */ }

  if (typeof em === 'number' && Date.now() - em < VIVO_TOLERANCIA_MS) return null

  const quando = typeof em === 'number'
    ? `há ${formatarIdade(Date.now() - em)}`
    : 'nesta sessão (sem rastro)'
  return `⚠️ agent desktop **sem sinal ${quando}** — watcher, Guardian e invariantes não estão rodando. Suba com \`rayzen-start.bat\`.`
}

function formatarIdade(ms) {
  const min = Math.round(ms / 60000)
  if (min < 90) return `${min}min`
  const h = Math.round(min / 60)
  return h < 48 ? `${h}h` : `${Math.round(h / 24)}d`
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

// ── Guardian cache (sync read < 5ms) ─────────────────────────────────────────

function readGuardianCache(projectId) {
  try {
    const hash = createHash('sha256').update(projectId).digest('hex').slice(0, 8)
    const file = join(tmpdir(), `rayzen-guardian-${hash}.json`)
    const raw  = readFileSync(file, 'utf8')
    const { report, expiresAt } = JSON.parse(raw)
    if (Date.now() > expiresAt) return null
    return report
  } catch { return null }
}

function formatGuardianSection(report) {
  if (!report) return null
  const levels = ['low', 'medium', 'high', 'critical']
  const threshold = process.env.AGENT_GUARDIAN_RISK_THRESHOLD ?? 'medium'
  if (levels.indexOf(report.riskLevel) < levels.indexOf(threshold)) return null

  const emoji = { low: '✅', medium: '⚠️', high: '🔴', critical: '🚨' }[report.riskLevel] ?? '⚠️'
  const lines = [
    `\n### ${emoji} Guardian — ${report.riskLevel.toUpperCase()} (${report.riskScore})`,
    report.summary,
  ]
  if (report.filesWithoutTests?.length) {
    lines.push(`**Sem spec:** ${report.filesWithoutTests.slice(0, 3).join(', ')}${report.filesWithoutTests.length > 3 ? ` +${report.filesWithoutTests.length - 3}` : ''}`)
  }
  lines.push(`**Deploy:** ${report.deployRecommend}`)
  return lines.join('\n')
}

// ── Invariantes do sistema (sync read < 5ms) ─────────────────────────────────
//
// O Guardian responde "o que você acabou de mudar tem teste?". Isto responde
// "o estado do sistema bate com o que deveria ser?" — a pergunta que nenhuma
// ferramenta respondia, e cuja ausência custou caro: servidor 115 dias com o
// relógio errado, projeto principal fora do project_catalog por dois meses,
// gate aprovado que nunca promoveu nada. Nenhum deles dava erro.

function readInvariantsCache(projectId) {
  try {
    const hash = createHash('sha256').update(projectId).digest('hex').slice(0, 8)
    const file = join(tmpdir(), `rayzen-invariants-${hash}.json`)
    const { report, expiresAt, rodadoEm } = JSON.parse(readFileSync(file, 'utf8'))
    if (Date.now() > expiresAt) return null
    // A idade viaja junto: o cache dura 30min e o throttle é de 15min, então o
    // bloco pode mostrar estado de meia hora atrás. Aconteceu — logo após uma
    // correção, o aviso ainda acusava a falha já resolvida, e não havia como
    // saber disso lendo o bloco. Estado sem data é indistinguível de estado atual.
    const idadeMin = rodadoEm ? Math.round((Date.now() - rodadoEm) / 60000) : null
    return { ...report, _idadeMin: idadeMin }
  } catch { return null }
}

function formatInvariantsSection(report) {
  if (!report) return null

  // Silencioso quando está tudo certo. Um bloco dizendo "8 de 8 ok" em todo
  // prompt seria exatamente o ruído que este projeto passou o dia removendo —
  // e ruído constante treina a ignorar o aviso que importa.
  const falhas = (report.resultados ?? []).filter((r) => !r.ok)
  if (falhas.length === 0) return null

  const emoji = { alta: '🚨', media: '⚠️', baixa: 'ℹ️' }[report.gravidadeMax] ?? '⚠️'
  const ordem = { alta: 0, media: 1, baixa: 2 }
  const idade = report._idadeMin === null || report._idadeMin === undefined
    ? ''
    : report._idadeMin < 1 ? ' · agora' : ` · medido há ${report._idadeMin}min`
  const lines = [`\n### ${emoji} Invariantes quebrados (${falhas.length} de ${falhas.length + (report.totalOk ?? 0)})${idade}`]

  for (const f of [...falhas].sort((a, b) => ordem[a.gravidade] - ordem[b.gravidade]).slice(0, 4)) {
    lines.push(`- **[${f.gravidade}] ${f.titulo}** — ${f.detalhe}`)
    if (f.correcao) lines.push(`  ↳ ${f.correcao}`)
  }
  if (falhas.length > 4) lines.push(`- _(+${falhas.length - 4} — ver GET /v2/invariants/latest)_`)

  return lines.join('\n')
}

// ── Meta pronta para fechar ───────────────────────────────────────────────────
// O fechamento de meta é manual por decisão do Marcelo — o Rayzen não marca
// "achieved" sozinho. O risco disso é a meta ficar 100% concluída e aberta por
// semanas, congelando o objetivo do projeto (aconteceu com a "Guardian Blueprint
// v1.1": 11/11 critérios, aberta de 29/jun a 05/ago). Este aviso existe pra que
// esquecer custe um prompt, não um mês.

function formatGoalReadyToClose(goal) {
  if (!goal) return null
  const criteria = goal.successCriteria ?? []
  if (criteria.length === 0) return null
  if (!criteria.every((c) => c.done)) return null

  return [
    '\n### ✅ Meta concluída — falta só fechar',
    `**${goal.title}** — ${criteria.length}/${criteria.length} critérios concluídos.`,
    `Para fechar: PATCH /projects/${goal.projectId}/graph/goal/${goal.id}/status com {"status":"achieved"}`,
    'Enquanto estiver aberta, o objetivo do projeto continua ancorado nela.',
  ].join('\n')
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

  const projectId = await resolveProjectId(cfg, extractCwd(raw))
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

  // Meta ativa — idem: precisa ser fresca pra detectar o momento em que fecha
  const goalPromise = httpGet(`${cfg.apiUrl}/projects/${encodeURIComponent(projectId)}/graph/goal`, cfg.apiToken, 1000)
    .then((r) => r?.goal ?? r ?? null)
    .catch(() => null)

  // Identidade sai nos DOIS caminhos — cache-hit e busca fresca. Sair só num deles
  // faria a sessao saber o endereco de forma intermitente, que e pior que nao saber.
  const identidade = formatarIdentidade(cfg, projectId, v2Base)

  if (cached) {
    const [mission, goal] = await Promise.all([missionPromise, goalPromise])
    const missionBlock  = formatActiveMission(mission)
    const goalBlock     = formatGoalReadyToClose(goal)
    const guardianBlock = formatGuardianSection(readGuardianCache(projectId))
    const invarBlock    = formatInvariantsSection(readInvariantsCache(projectId))
    const full = [identidade, cached, missionBlock, goalBlock, guardianBlock, invarBlock].filter(Boolean).join('')
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

  // Append missão ativa e meta (já em paralelo desde o início)
  const [mission, goal] = await Promise.all([missionPromise, goalPromise])
  const missionBlock = formatActiveMission(mission)
  const goalBlock = formatGoalReadyToClose(goal)
  const guardianBlock = formatGuardianSection(readGuardianCache(projectId))
  const invarBlock    = formatInvariantsSection(readInvariantsCache(projectId))
  const full = [identidade, context, missionBlock, goalBlock, guardianBlock, invarBlock].filter(Boolean).join('')

  writeTimingFile({ hookDurationMs: Date.now() - t0, contextEngineDurationMs: ceMs || null, cacheHit: false, mode, projectId })
  console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: full } }))
  process.exit(0)
}

main().catch(() => process.exit(0))
