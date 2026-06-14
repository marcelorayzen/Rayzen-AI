#!/usr/bin/env node
/**
 * Rayzen AI — Claude Code Hook
 *
 * Recebe o payload do hook via stdin, enriquece com contexto git e envia
 * para POST /events/cli.
 *
 * Configurar em ~/.claude/settings.json (ver docs/roadmap.md Fase 3).
 *
 * Prioridade de configuração:
 *   1. Variáveis de ambiente: RAYZEN_API_URL, RAYZEN_API_TOKEN, RAYZEN_PROJECT_ID
 *   2. Arquivo: apps/agent/src/hooks/hook.config.mjs (não commitado)
 */

import { request } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, dirname, extname } from 'node:path'
import { execSync } from 'node:child_process'
import { tmpdir } from 'node:os'

const INDEXABLE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.md', '.mdx', '.txt', '.json', '.yaml', '.yml',
  '.sql', '.prisma', '.css', '.html', '.py', '.sh', '.bat', '.ps1',
])

function readFileContent(filePath) {
  try {
    if (!filePath) return null
    const ext = extname(filePath).toLowerCase()
    if (!INDEXABLE_EXTENSIONS.has(ext)) return null
    if (!existsSync(filePath)) return null
    const content = readFileSync(filePath, 'utf8')
    return content.slice(0, 8000)
  } catch { return null }
}

const __dir = dirname(fileURLToPath(import.meta.url))
const CONFIG_PATH = join(__dir, 'hook.config.mjs')

async function loadConfig() {
  let cfg = {}
  if (existsSync(CONFIG_PATH)) {
    try {
      const fileUrl = new URL(`file:///${CONFIG_PATH.replace(/\\/g, '/')}`)
      const mod = await import(fileUrl.href)
      cfg = mod.default ?? {}
    } catch { /* ignora */ }
  }
  return {
    apiUrl:    process.env.RAYZEN_API_URL    ?? cfg.apiUrl    ?? 'http://localhost:3001',
    apiV2Url:  process.env.RAYZEN_API_V2_URL ?? cfg.apiV2Url  ?? null,
    apiToken:  process.env.RAYZEN_API_TOKEN  ?? cfg.apiToken  ?? '',
    projectId: process.env.RAYZEN_PROJECT_ID ?? cfg.projectId ?? '',
  }
}

function inferModulesFromPaths(filePaths) {
  const modules = new Set()
  for (const fp of filePaths) {
    const normalized = fp.replace(/\\/g, '/')
    // apps/api/src/modules/X/... → api:X
    const apiModule = normalized.match(/apps\/api\/src\/modules\/([^/]+)/)
    if (apiModule) { modules.add(`api:${apiModule[1]}`); continue }
    // apps/web/app/components/X... → web:components
    if (/apps\/web\/app\/components/.test(normalized)) { modules.add('web:components'); continue }
    // apps/web/app/hooks/... → web:hooks
    if (/apps\/web\/app\/hooks/.test(normalized)) { modules.add('web:hooks'); continue }
    // apps/web/app/... → web:pages
    if (/apps\/web\/app/.test(normalized)) { modules.add('web:pages'); continue }
    // apps/agent/src/actions/... → agent:actions
    if (/apps\/agent\/src\/actions/.test(normalized)) { modules.add('agent:actions'); continue }
    // apps/agent/src/hooks/... → agent:hooks
    if (/apps\/agent\/src\/hooks/.test(normalized)) { modules.add('agent:hooks'); continue }
    // infra/... → infra
    if (/^infra\//.test(normalized)) { modules.add('infra'); continue }
    // prisma/schema.prisma → api:schema
    if (/prisma\/schema\.prisma/.test(normalized)) { modules.add('api:schema'); continue }
  }
  return [...modules]
}

function getGraphifyContext(repoRoot) {
  try {
    const graphPath = join(repoRoot, 'graphify-out', 'graph.json')
    if (!existsSync(graphPath)) return null
    const raw = readFileSync(graphPath, 'utf8')
    const graph = JSON.parse(raw)
    const fileCounts = {}
    for (const node of (graph.nodes ?? [])) {
      const src = node.source_file
      if (src) fileCounts[src] = (fileCounts[src] ?? 0) + 1
    }
    const totalFiles = Object.keys(fileCounts).length
    const totalNodes = (graph.nodes ?? []).length
    const totalEdges = (graph.edges ?? []).length
    return { totalFiles, totalNodes, totalEdges, updatedAt: new Date().toISOString() }
  } catch { return null }
}

function getGitContext() {
  try {
    const branch = execSync('git rev-parse --abbrev-ref HEAD', {
      encoding: 'utf8', timeout: 2000, stdio: ['pipe', 'pipe', 'ignore'],
    }).trim()

    const log = execSync('git log -1 --format=%H|||%s|||%an', {
      encoding: 'utf8', timeout: 2000, stdio: ['pipe', 'pipe', 'ignore'],
    }).trim()

    const parts = log.split('|||')
    const commitHash = parts[0]?.slice(0, 8) ?? ''
    const commitMessage = parts[1]?.trim() ?? ''
    const commitAuthor = parts[2]?.trim() ?? ''

    // Arquivos modificados — top 10
    let changedFiles = []
    try {
      const filesRaw = execSync('git diff --name-only HEAD 2>/dev/null || git status --short --porcelain', {
        encoding: 'utf8', timeout: 2000, stdio: ['pipe', 'pipe', 'ignore'],
      }).trim()
      changedFiles = filesRaw
        .split('\n')
        .map(l => l.replace(/^[MADRCU?! ]+/, '').trim())
        .filter(Boolean)
        .slice(0, 10)
    } catch { /* ignora */ }

    return { branch, commitHash, commitMessage, commitAuthor, changedFiles }
  } catch {
    return null
  }
}

function getProjectName() {
  try {
    // Preferência: nome do repositório no git remote
    const remote = execSync('git remote get-url origin', {
      encoding: 'utf8', timeout: 2000, stdio: ['pipe', 'pipe', 'ignore'],
    }).trim()
    const match = remote.match(/\/([^/]+?)(?:\.git)?$/)
    if (match?.[1]) return match[1]
  } catch { /* sem remote */ }
  try {
    // Fallback: nome do diretório raiz do repositório
    const root = execSync('git rev-parse --show-toplevel', {
      encoding: 'utf8', timeout: 2000, stdio: ['pipe', 'pipe', 'ignore'],
    }).trim()
    return root.split(/[\\/]/).pop() ?? null
  } catch { return null }
}

async function readStdin() {
  return new Promise((resolve) => {
    let data = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', chunk => { data += chunk })
    process.stdin.on('end', () => resolve(data))
    setTimeout(() => resolve(data), 3000)
  })
}

function post(url, body, token) {
  return new Promise((resolve) => {
    const parsed = new URL(url)
    const isHttps = parsed.protocol === 'https:'
    const lib = isHttps ? httpsRequest : request
    const payload = JSON.stringify(body)

    const req = lib({
      hostname: parsed.hostname,
      port: parsed.port || (isHttps ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    }, (res) => {
      res.resume()
      resolve(res.statusCode)
    })

    req.on('error', () => resolve(0))
    req.setTimeout(5000, () => { req.destroy(); resolve(0) })
    req.write(payload)
    req.end()
  })
}

// Cache de resolução repoSlug → projectId (arquivo temporário, TTL 5 min)
const SLUG_CACHE_FILE = join(tmpdir(), 'rayzen-slug-cache.json')
const SLUG_CACHE_TTL = 5 * 60 * 1000

// Lê o cache bruto (sem checar TTL) — usado para fallback stale-while-error
function readSlugCacheRaw() {
  try {
    return JSON.parse(readFileSync(SLUG_CACHE_FILE, 'utf8'))
  } catch { return null }
}

function readSlugCache() {
  const cache = readSlugCacheRaw()
  if (cache && Date.now() - cache.ts < SLUG_CACHE_TTL) return cache
  return null
}

function writeSlugCache(slug, projectId) {
  try {
    writeFileSync(SLUG_CACHE_FILE, JSON.stringify({ slug, projectId, ts: Date.now() }), 'utf8')
  } catch { /* ignora */ }
}

// Aviso de resolução falha — visível no Claude Code (exit 2), no máximo 1x/hora
const WARN_FILE = join(tmpdir(), 'rayzen-hook-warn.json')
const WARN_THROTTLE = 60 * 60 * 1000  // 1 hora

function warnUnresolved(slug) {
  // stderr sempre (para logs), mas exit 2 (visível) só após throttle
  process.stderr.write(`[rayzen-hook] projectId não resolvido para "${slug ?? '?'}".\n`)
  let last = 0
  try { last = JSON.parse(readFileSync(WARN_FILE, 'utf8')).ts ?? 0 } catch { /* ignora */ }
  if (Date.now() - last < WARN_THROTTLE) return  // já avisou recentemente — silencioso

  try { writeFileSync(WARN_FILE, JSON.stringify({ slug, ts: Date.now() }), 'utf8') } catch { /* ignora */ }
  process.stderr.write(
    `\n⚠️  Rayzen: a atividade deste repositório ("${slug ?? '?'}") NÃO está sendo vinculada a um projeto.\n` +
    `   Provável: nenhum projeto com esse repoSlug no Rayzen, ou repoSlug divergente.\n` +
    `   Verifique: GET /events/hook/health  ·  ou fixe projectId em apps/agent/src/hooks/hook.config.mjs\n`,
  )
  // exit 2 faz o Claude Code exibir o stderr ao usuário (PostToolUse não bloqueia a ação já executada)
  process.exitCode = 2
}

async function resolveProjectId(cfg) {
  // Prioridade 1: config explícito
  if (cfg.projectId) return cfg.projectId

  const slug = getProjectName()
  if (!slug) return null

  // Prioridade 2: cache fresco (dentro do TTL)
  const cached = readSlugCache()
  if (cached?.slug === slug) return cached.projectId

  // Prioridade 3: busca na API por repoSlug
  try {
    const url = `${cfg.apiUrl}/projects?repoSlug=${encodeURIComponent(slug)}`
    const parsed = new URL(url)
    const isHttps = parsed.protocol === 'https:'
    const lib = isHttps ? httpsRequest : request

    const projectId = await new Promise((resolve) => {
      const req = lib({
        hostname: parsed.hostname,
        port: parsed.port || (isHttps ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method: 'GET',
        headers: { Authorization: `Bearer ${cfg.apiToken}` },
      }, (res) => {
        let body = ''
        res.on('data', d => { body += d })
        res.on('end', () => {
          try {
            const projects = JSON.parse(body)
            resolve(Array.isArray(projects) && projects.length > 0 ? projects[0].id : null)
          } catch { resolve(null) }
        })
      })
      req.on('error', () => resolve(null))
      req.setTimeout(5000, () => { req.destroy(); resolve(null) })
      req.end()
    })

    if (projectId) { writeSlugCache(slug, projectId); return projectId }

    // Stale-while-error: query falhou (rede/timeout). Em vez de mandar órfão,
    // reusa o cache do MESMO slug mesmo expirado — o projectId não muda.
    // Isso elimina "desconexões" por hiccups transitórios de rede.
    const stale = readSlugCacheRaw()
    if (stale?.slug === slug) return stale.projectId

    return null
  } catch {
    const stale = readSlugCacheRaw()
    if (stale?.slug === slug) return stale.projectId
    return null
  }
}

/**
 * Persiste um turn de conversa no Brain via POST /v2/chat/turns.
 * Fire-and-forget — nunca bloqueia o hook.
 */
function persistConversationTurn(v2BaseUrl, token, body) {
  try {
    const url = `${v2BaseUrl}/v2/chat/turns`
    post(url, body, token).catch(() => {})
  } catch { /* ignora */ }
}

function toRelative(absPath, root) {
  if (!absPath) return ''
  const n = absPath.replace(/\\/g, '/')
  if (!root) return n
  const r = root.replace(/\\/g, '/')
  return n.startsWith(r + '/') ? n.slice(r.length + 1) : n
}

async function main() {
  const [raw, cfg] = await Promise.all([readStdin(), loadConfig()])
  if (!raw.trim()) return

  let payload
  try {
    payload = JSON.parse(raw)
  } catch {
    process.exit(0)
  }

  // Ferramentas sem sinal semântico — ignorar completamente
  const tool = payload.tool_name ?? ''
  const IGNORED_TOOLS = new Set([
    'TodoWrite', 'TodoRead', 'ListMcpResourcesTool',
    'ToolSearch', 'Agent', 'ScheduleWakeup',
    'EnterPlanMode', 'ExitPlanMode', 'AskUserQuestion',
    'Read',  // exploração, não mudança — quase sempre ruído
  ])
  // Ignorar leituras do Rayzen (não criar evento ao consultar estado)
  if (IGNORED_TOOLS.has(tool) ||
      tool.startsWith('mcp__rayzen__rayzen_get') ||
      tool.startsWith('mcp__rayzen__rayzen_search')) {
    process.exit(0)
  }

  // Detecta projectId automaticamente por repoSlug, com fallback para config fixo
  const projectId = await resolveProjectId(cfg)
  if (projectId) {
    payload.projectId = projectId
  } else {
    const name = getProjectName()
    if (name) payload.projectName = name
    // Aviso ativo (throttle 1h): falha de resolução fica VISÍVEL no Claude Code via exit 2
    warnUnresolved(name)
  }

  // Enriquecer com contexto git (não bloqueia se falhar)
  const git = getGitContext()
  if (git) {
    payload.git = git
    if (git.changedFiles?.length) {
      const modules = inferModulesFromPaths(git.changedFiles)
      if (modules.length) payload.graphify = { modules }
    }
  }

  // Contexto do graphify — hoist repoRoot para reuso
  let repoRoot = null
  try {
    repoRoot = execSync('git rev-parse --show-toplevel', {
      encoding: 'utf8', timeout: 2000, stdio: ['pipe', 'pipe', 'ignore'],
    }).trim()
    const graphifyCtx = getGraphifyContext(repoRoot)
    if (graphifyCtx) payload.graphifyStats = graphifyCtx
  } catch { /* ignora */ }

  // Bash/PowerShell: substituir command completo (ruído) por description (sinal)
  if (tool === 'Bash' || tool === 'PowerShell') {
    const desc = payload.tool_input?.description
    if (desc) payload.tool_input = { ...payload.tool_input, _useDescription: true }
  }

  // Stop event: persiste o último turn do assistente no Brain para memória cross-sessão
  const hookEvent = payload.hook_event_name ?? ''
  if (hookEvent === 'Stop' && projectId) {
    const transcript = Array.isArray(payload.transcript) ? payload.transcript : []
    const lastAssistant = [...transcript].reverse().find((m) => m.role === 'assistant')
    if (lastAssistant) {
      const content = typeof lastAssistant.content === 'string'
        ? lastAssistant.content
        : Array.isArray(lastAssistant.content)
          ? lastAssistant.content.map((b) => (typeof b === 'string' ? b : (b?.text ?? ''))).join('\n')
          : ''
      if (content.trim()) {
        const v2Base = (cfg.apiV2Url ?? cfg.apiUrl).replace(/\/$/, '')
        persistConversationTurn(v2Base, cfg.apiToken, {
          projectId,
          sessionId:  payload.session_id,
          role:       'assistant',
          content:    content.slice(0, 8000),
          source:     'claude-code',
        })
      }
    }
  }

  // Edit/Write: indexação semântica + catalog auto-register
  let catalogPromise = Promise.resolve()
  if (tool === 'Edit' || tool === 'Write') {
    const filePath = payload.tool_input?.file_path ?? payload.tool_input?.path
    const content = readFileContent(filePath)
    if (content) payload.fileContent = content

    if (projectId && filePath) {
      const rel = toRelative(filePath, repoRoot)
      catalogPromise = post(
        `${cfg.apiUrl}/data-catalog/assets/auto-register`,
        { projectId, filePath: rel, tool },
        cfg.apiToken,
      )
    }
  }

  await Promise.all([
    post(`${cfg.apiUrl}/events/cli`, payload, cfg.apiToken),
    catalogPromise,
  ])
  // Preserva exitCode 2 definido por warnUnresolved (aviso visível); senão 0
  process.exit(process.exitCode ?? 0)
}

main().catch(() => process.exit(0))
