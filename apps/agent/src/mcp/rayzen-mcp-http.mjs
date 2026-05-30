/**
 * Rayzen MCP — HTTP/SSE transport (Claude Desktop)
 *
 * Expõe os mesmos 13 tools do rayzen-mcp.mjs via HTTP Streamable,
 * para ser consumido pelo Claude Desktop como conector personalizado.
 *
 * Env vars:
 *   AGENT_API_URL   — URL da API Rayzen  (default: http://api:3001)
 *   AGENT_TOKEN     — Bearer token para a API Rayzen
 *   MCP_TOKEN       — Bearer token que o cliente (Claude Desktop) deve enviar
 *   MCP_PORT        — Porta de escuta (default: 3102)
 *   MCP_PROJECT_ID  — projectId padrão quando o cliente não informa
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'

const API_URL             = process.env.AGENT_API_URL       ?? 'http://api:3001'
const API_TOKEN           = process.env.AGENT_TOKEN         ?? ''
const MCP_PORT            = Number(process.env.MCP_PORT     ?? 3102)
const DEFAULT_PID         = process.env.MCP_PROJECT_ID      ?? ''
const ADMIN_PASSWORD      = process.env.ADMIN_PASSWORD      ?? ''
const OAUTH_CLIENT_ID     = process.env.OAUTH_CLIENT_ID     ?? 'claude-ai'
const OAUTH_CLIENT_SECRET = process.env.OAUTH_CLIENT_SECRET ?? ''
const MCP_BASE_URL        = (process.env.MCP_BASE_URL       ?? 'https://rayzen.com.br').replace(/\/$/, '')

// ── Token persistence ────────────────────────────────────────────────────────
const TOKEN_FILE = join('/app/storage/mcp', 'tokens.json')

function loadPersistedTokens() {
  try {
    mkdirSync(dirname(TOKEN_FILE), { recursive: true })
    const raw = readFileSync(TOKEN_FILE, 'utf-8')
    const data = JSON.parse(raw)
    const map = new Map(Object.entries(data))
    // Remove expired
    const now = Date.now()
    for (const [k, v] of map) { if (v < now) map.delete(k) }
    console.log(`[MCP] Loaded ${map.size} persisted tokens`)
    return map
  } catch { return new Map() }
}

function saveTokens(map) {
  try {
    mkdirSync(dirname(TOKEN_FILE), { recursive: true })
    writeFileSync(TOKEN_FILE, JSON.stringify(Object.fromEntries(map)), 'utf-8')
  } catch (e) { console.warn('[MCP] Could not persist tokens:', e.message) }
}

// ── OAuth state ───────────────────────────────────────────────────────────────
const authCodes    = new Map() // code  → { redirectUri, expiresAt }
const accessTokens = loadPersistedTokens()  // token → expiresAt (persisted)

const CODE_TTL  = 5  * 60 * 1000           // 5 min
const TOKEN_TTL = 30 * 24 * 60 * 60 * 1000 // 30 days

function issueCode(redirectUri) {
  const code = randomUUID()
  authCodes.set(code, { redirectUri, expiresAt: Date.now() + CODE_TTL })
  return code
}

function issueToken() {
  const token = randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '')
  accessTokens.set(token, Date.now() + TOKEN_TTL)
  saveTokens(accessTokens)   // persist immediately
  return token
}

function isValidToken(token) {
  const exp = accessTokens.get(token)
  if (!exp) return false
  if (Date.now() > exp) { accessTokens.delete(token); saveTokens(accessTokens); return false }
  return true
}

// ── Rayzen API helper ────────────────────────────────────────────────────────

function apiHeaders() {
  return { Authorization: `Bearer ${API_TOKEN}`, 'Content-Type': 'application/json' }
}

async function api(method, path, body) {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: apiHeaders(),
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => String(res.status))
    throw new Error(`Rayzen API ${method} ${path} → ${res.status}: ${text}`)
  }
  return res.json().catch(() => null)
}

function resolveProjectId(args) {
  const pid = args.projectId ?? DEFAULT_PID
  if (!pid || !String(pid).trim()) {
    throw new Error(
      'projectId não definido. Informe projectId na chamada ou defina MCP_PROJECT_ID no ambiente.',
    )
  }
  return pid
}

// ── Tool definitions (idênticas ao rayzen-mcp.mjs) ──────────────────────────

const TOOLS = [
  {
    name: 'rayzen_get_state',
    description: 'Estado atual do projeto: objetivo, stage, milestones, blockers, riscos, próximos passos.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'ID do projeto' },
      },
    },
  },
  {
    name: 'rayzen_get_resume',
    description: 'Brief de retomada: o que mudou desde a última sessão, blockers ativos, próximo passo recomendado.',
    inputSchema: { type: 'object', properties: { projectId: { type: 'string' } } },
  },
  {
    name: 'rayzen_get_events',
    description: 'Últimos eventos da timeline do projeto (ações, decisões, problemas, ideias).',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        limit: { type: 'number', description: 'Quantidade de eventos (padrão: 20)' },
        intent: { type: 'string', description: 'Filtro de intent: decision | problem | idea | reference | checkpoint' },
      },
    },
  },
  {
    name: 'rayzen_search_memory',
    description: 'Busca semântica no Brain do projeto (documentos indexados, wiki, código).',
    inputSchema: {
      type: 'object',
      required: ['query'],
      properties: {
        query: { type: 'string' },
        projectId: { type: 'string' },
        limit: { type: 'number', description: 'Número de resultados (padrão: 5)' },
      },
    },
  },
  {
    name: 'rayzen_get_goal',
    description: 'Meta ativa do projeto com critérios de sucesso, KPIs, gap analysis e Next Best Action.',
    inputSchema: { type: 'object', properties: { projectId: { type: 'string' } } },
  },
  {
    name: 'rayzen_get_wiki',
    description: 'Retorna uma página da wiki do projeto por slug.',
    inputSchema: {
      type: 'object',
      required: ['slug'],
      properties: {
        slug: { type: 'string', description: 'Slug da página wiki (ex: arquitetura, decisoes)' },
      },
    },
  },
  {
    name: 'rayzen_add_event',
    description: 'Registra um evento manualmente no projeto: decisão, ideia ou problema.',
    inputSchema: {
      type: 'object',
      required: ['content', 'intent'],
      properties: {
        content: { type: 'string' },
        intent: { type: 'string', enum: ['decision', 'idea', 'problem', 'reference'] },
        projectId: { type: 'string' },
      },
    },
  },
  {
    name: 'rayzen_checkpoint',
    description: 'Cria um checkpoint de sessão: sintetiza o que foi feito, decisões, próximos passos.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        sessionId: { type: 'string' },
      },
    },
  },
  {
    name: 'rayzen_update_planning',
    description: 'Atualiza o planejamento do projeto: milestones, blockers, próximos passos.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        milestones: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              title: { type: 'string' },
              status: { type: 'string', enum: ['pending', 'active', 'done'] },
            },
          },
        },
        blockers: { type: 'array', items: { type: 'string' } },
        nextSteps: { type: 'array', items: { type: 'string' } },
      },
    },
  },
  {
    name: 'rayzen_blueprint_preview',
    description: 'Analisa um Blueprint em Markdown ou JSON e retorna o que seria criado sem salvar nada.',
    inputSchema: {
      type: 'object',
      required: ['title', 'content', 'format'],
      properties: {
        projectId: { type: 'string' },
        title: { type: 'string' },
        content: { type: 'string' },
        format: { type: 'string', enum: ['markdown', 'json'] },
      },
    },
  },
  {
    name: 'rayzen_blueprint_import',
    description: 'Importa um Blueprint completo: cria Wiki, indexa no Brain, registra eventos e atualiza planejamento.',
    inputSchema: {
      type: 'object',
      required: ['title', 'content', 'format', 'source'],
      properties: {
        projectId: { type: 'string' },
        title: { type: 'string' },
        content: { type: 'string' },
        format: { type: 'string', enum: ['markdown', 'json'] },
        source: { type: 'string', enum: ['chatgpt', 'claude', 'manual', 'github', 'notion'] },
        mode: { type: 'string', enum: ['architecture', 'implementation', 'debugging', 'review', 'study'] },
        saveToWiki: { type: 'boolean' },
        indexInBrain: { type: 'boolean' },
        updateProjectState: { type: 'boolean' },
        createEvents: { type: 'boolean' },
        generateNextSteps: { type: 'boolean' },
        overwriteWiki: { type: 'boolean' },
      },
    },
  },
  {
    name: 'rayzen_blueprint_import_markdown',
    description: 'Atalho para importar um planejamento Markdown com todas as opções ativas.',
    inputSchema: {
      type: 'object',
      required: ['title', 'markdown'],
      properties: {
        projectId: { type: 'string' },
        title: { type: 'string' },
        markdown: { type: 'string' },
        source: { type: 'string', enum: ['chatgpt', 'claude', 'manual', 'github', 'notion'] },
        overwriteWiki: { type: 'boolean' },
      },
    },
  },
  {
    name: 'rayzen_blueprint_create_feature_plan',
    description: 'Gera um Blueprint Markdown estruturado para uma feature usando o contexto do ProjectState.',
    inputSchema: {
      type: 'object',
      required: ['feature'],
      properties: {
        feature: { type: 'string' },
        projectId: { type: 'string' },
        context: { type: 'string' },
        mode: { type: 'string', enum: ['architecture', 'implementation', 'debugging', 'review', 'study'] },
        autoImport: { type: 'boolean' },
      },
    },
  },
]

// ── MCP Server ───────────────────────────────────────────────────────────────

function createMcpServer() {
  const srv = new Server(
    { name: 'rayzen', version: '1.0.0' },
    { capabilities: { tools: {} } },
  )

  srv.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }))

  srv.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args = {} } = req.params
    try {
      const pid = () => resolveProjectId(args)
      let result

      switch (name) {
        case 'rayzen_get_state':
          result = await api('GET', `/projects/${pid()}/state`)
          break

        case 'rayzen_get_resume':
          result = await api('POST', `/projects/${pid()}/resume`, {})
          break

        case 'rayzen_get_events': {
          const limit = args.limit ?? 20
          const intent = args.intent ? `&intent=${args.intent}` : ''
          result = await api('GET', `/events?project_id=${pid()}&limit=${limit}${intent}`)
          break
        }

        case 'rayzen_search_memory':
          result = await api('POST', '/brain/search', {
            query: args.query,
            projectId: pid(),
            limit: args.limit ?? 5,
          })
          break

        case 'rayzen_get_goal':
          result = await api('GET', `/projects/${pid()}/graph/goal`)
          break

        case 'rayzen_get_wiki':
          result = await api('GET', `/wiki/${encodeURIComponent(args.slug)}`)
          break

        case 'rayzen_add_event':
          result = await api('POST', '/events/cli', {
            content: args.content,
            intent: args.intent,
            projectId: pid(),
            source: 'claude-desktop-mcp',
            type: 'note',
          })
          break

        case 'rayzen_checkpoint':
          result = await api('POST', '/synthesis/checkpoint', {
            projectId: pid(),
            sessionId: args.sessionId,
          })
          break

        case 'rayzen_update_planning': {
          const patch = {}
          if (args.milestones) patch.milestones = args.milestones
          if (args.blockers) patch.blockers = args.blockers
          if (args.nextSteps) patch.nextSteps = args.nextSteps
          result = await api('PATCH', `/projects/${pid()}/state/planning`, patch)
          break
        }

        case 'rayzen_blueprint_preview':
          result = await api('POST', '/blueprint/preview', {
            projectId: pid(),
            title: args.title,
            content: args.content,
            format: args.format ?? 'markdown',
          })
          break

        case 'rayzen_blueprint_import':
          result = await api('POST', '/blueprint/import', {
            projectId: pid(),
            title: args.title,
            content: args.content,
            format: args.format ?? 'markdown',
            source: args.source ?? 'claude',
            mode: args.mode,
            options: {
              saveToWiki: args.saveToWiki ?? true,
              indexInBrain: args.indexInBrain ?? true,
              updateProjectState: args.updateProjectState ?? true,
              createEvents: args.createEvents ?? true,
              generateNextSteps: args.generateNextSteps ?? true,
              overwriteWiki: args.overwriteWiki ?? false,
            },
          })
          break

        case 'rayzen_blueprint_import_markdown':
          result = await api('POST', '/blueprint/import', {
            projectId: pid(),
            title: args.title,
            content: args.markdown,
            format: 'markdown',
            source: args.source ?? 'claude',
            options: {
              saveToWiki: true,
              indexInBrain: true,
              updateProjectState: true,
              createEvents: true,
              generateNextSteps: true,
              overwriteWiki: args.overwriteWiki ?? false,
            },
          })
          break

        case 'rayzen_blueprint_create_feature_plan': {
          const plan = await api('POST', '/blueprint/plan', {
            feature: args.feature,
            projectId: args.projectId ?? DEFAULT_PID ?? undefined,
            context: args.context,
            mode: args.mode ?? 'implementation',
          })
          if (args.autoImport && plan?.markdown) {
            const importResult = await api('POST', '/blueprint/import', {
              projectId: pid(),
              title: plan.title,
              content: plan.markdown,
              format: 'markdown',
              source: 'claude',
              mode: args.mode ?? 'implementation',
              options: {
                saveToWiki: true,
                indexInBrain: true,
                updateProjectState: true,
                createEvents: true,
                generateNextSteps: true,
                overwriteWiki: false,
              },
            })
            result = { plan, import: importResult }
          } else {
            result = plan
          }
          break
        }

        default:
          throw new Error(`Tool desconhecida: ${name}`)
      }

      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Erro: ${err.message}` }],
        isError: true,
      }
    }
  })

  return srv
}

// ── HTTP server with session management ─────────────────────────────────────

const transports = new Map() // sessionId → StreamableHTTPServerTransport

function checkAuth(req, res) {
  const auth = req.headers['authorization'] ?? ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null
  if (!token || !isValidToken(token)) {
    res.writeHead(401, {
      'Content-Type': 'application/json',
      'WWW-Authenticate': `Bearer realm="${MCP_BASE_URL}/mcp"`,
    })
    res.end(JSON.stringify({ error: 'unauthorized' }))
    return false
  }
  return true
}

const LOGIN_HTML = (state, redirectUri, clientId, error = '') => `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Rayzen AI — Autorizar acesso</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{background:#09090b;color:#f4f4f5;font-family:system-ui,sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:1rem}
    .card{width:100%;max-width:360px}
    .logo{display:flex;align-items:center;gap:.75rem;margin-bottom:2rem;justify-content:center}
    .logo svg{width:40px;height:40px}
    h1{font-size:1.25rem;font-weight:600;text-align:center;color:#f4f4f5}
    p{font-size:.875rem;color:#71717a;text-align:center;margin-top:.5rem}
    .app{background:#18181b;border:1px solid #27272a;border-radius:.75rem;padding:.75rem 1rem;margin:1.5rem 0;font-size:.8rem;color:#a1a1aa;word-break:break-all}
    input{width:100%;background:#18181b;border:1px solid #27272a;border-radius:.75rem;padding:.875rem 1rem;font-size:.875rem;color:#f4f4f5;outline:none;margin-bottom:1rem}
    input:focus{border-color:#3f3f46}
    .error{color:#f87171;font-size:.8rem;text-align:center;margin-bottom:.75rem}
    button{width:100%;background:#f4f4f5;color:#09090b;border:none;border-radius:.75rem;padding:.875rem;font-size:.875rem;font-weight:500;cursor:pointer}
    button:hover{background:#fff}
  </style>
</head>
<body>
<div class="card">
  <div class="logo">
    <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" fill="none">
      <rect width="100" height="100" rx="22" fill="#0a0a0a"/>
      <path d="M50 15 L80 68 L20 68 Z" stroke="#3b82f6" stroke-width="1.5" stroke-linejoin="round" opacity="0.2"/>
      <line x1="50" y1="50" x2="50" y2="15" stroke="#3b82f6" stroke-width="2.5" stroke-linecap="round" opacity="0.6"/>
      <line x1="50" y1="50" x2="80" y2="68" stroke="#3b82f6" stroke-width="2.5" stroke-linecap="round" opacity="0.6"/>
      <line x1="50" y1="50" x2="20" y2="68" stroke="#3b82f6" stroke-width="2.5" stroke-linecap="round" opacity="0.6"/>
      <circle cx="50" cy="15" r="7" fill="#0a0a0a" stroke="#3b82f6" stroke-width="1.8"/>
      <circle cx="80" cy="68" r="7" fill="#0a0a0a" stroke="#3b82f6" stroke-width="1.8"/>
      <circle cx="20" cy="68" r="7" fill="#0a0a0a" stroke="#3b82f6" stroke-width="1.8"/>
      <circle cx="50" cy="50" r="13" fill="url(#cg)" filter="url(#glow)"/>
      <defs>
        <radialGradient id="cg" cx="36%" cy="30%" r="65%"><stop offset="0%" stop-color="#93c5fd"/><stop offset="100%" stop-color="#1d4ed8"/></radialGradient>
        <filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur in="SourceGraphic" stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
      </defs>
    </svg>
    <h1>Rayzen AI</h1>
  </div>
  <p>Autorize o acesso de <strong style="color:#f4f4f5">${clientId}</strong></p>
  <div class="app">🔗 ${redirectUri}</div>
  ${error ? `<p class="error">${error}</p>` : ''}
  <form method="POST" action="/oauth/authorize">
    <input type="hidden" name="state" value="${state}">
    <input type="hidden" name="redirect_uri" value="${redirectUri}">
    <input type="hidden" name="client_id" value="${clientId}">
    <input type="password" name="password" placeholder="Senha" autofocus autocomplete="current-password">
    <button type="submit">Autorizar acesso</button>
  </form>
</div>
</body></html>`

async function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

const httpServer = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${MCP_PORT}`)

  // ── Health check ────────────────────────────────────────────────────────────
  if (req.method === 'GET' && url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true, service: 'rayzen-mcp-http' }))
    return
  }

  // ── OAuth discovery ─────────────────────────────────────────────────────────
  if (req.method === 'GET' && url.pathname === '/.well-known/oauth-authorization-server') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
    res.end(JSON.stringify({
      issuer: MCP_BASE_URL,
      authorization_endpoint: `${MCP_BASE_URL}/oauth/authorize`,
      token_endpoint: `${MCP_BASE_URL}/oauth/token`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code'],
      code_challenge_methods_supported: [],
    }))
    return
  }

  // ── OAuth authorize (GET → login page) ──────────────────────────────────────
  if (req.method === 'GET' && url.pathname === '/oauth/authorize') {
    const redirectUri = url.searchParams.get('redirect_uri') ?? ''
    const state       = url.searchParams.get('state') ?? ''
    const clientId    = url.searchParams.get('client_id') ?? ''
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(LOGIN_HTML(state, redirectUri, clientId))
    return
  }

  // ── OAuth authorize (POST → valida senha e redireciona com code) ─────────────
  if (req.method === 'POST' && url.pathname === '/oauth/authorize') {
    const body = await readBody(req)
    const params = new URLSearchParams(body.toString())
    const password    = params.get('password') ?? ''
    const redirectUri = params.get('redirect_uri') ?? ''
    const state       = params.get('state') ?? ''
    const clientId    = params.get('client_id') ?? ''

    if (!ADMIN_PASSWORD || password !== ADMIN_PASSWORD) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(LOGIN_HTML(state, redirectUri, clientId, 'Senha incorreta'))
      return
    }

    const code = issueCode(redirectUri)
    const dest = new URL(redirectUri)
    dest.searchParams.set('code', code)
    if (state) dest.searchParams.set('state', state)
    res.writeHead(302, { Location: dest.toString() })
    res.end()
    return
  }

  // ── OAuth token (troca code por access_token) ────────────────────────────────
  if (req.method === 'POST' && url.pathname === '/oauth/token') {
    const body = await readBody(req)
    const params = new URLSearchParams(body.toString())
    const grantType   = params.get('grant_type')
    const code        = params.get('code') ?? ''
    const clientId    = params.get('client_id') ?? ''
    const clientSecret = params.get('client_secret') ?? ''
    const redirectUri = params.get('redirect_uri') ?? ''

    const entry = authCodes.get(code)
    if (
      grantType !== 'authorization_code' ||
      !entry ||
      Date.now() > entry.expiresAt ||
      clientId !== OAUTH_CLIENT_ID ||
      (OAUTH_CLIENT_SECRET && clientSecret !== OAUTH_CLIENT_SECRET) ||
      entry.redirectUri !== redirectUri
    ) {
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'invalid_grant' }))
      return
    }

    authCodes.delete(code)
    const token = issueToken()
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
    res.end(JSON.stringify({
      access_token: token,
      token_type: 'Bearer',
      expires_in: TOKEN_TTL / 1000,
    }))
    return
  }

  // ── CORS preflight ───────────────────────────────────────────────────────────
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization,Content-Type,mcp-session-id', 'Access-Control-Allow-Methods': 'GET,POST,DELETE' })
    res.end()
    return
  }

  if (!checkAuth(req, res)) return

  if (url.pathname !== '/mcp') {
    res.writeHead(404)
    res.end('Not found')
    return
  }

  if (req.method === 'POST') {
    const sessionId = req.headers['mcp-session-id']
    let transport = sessionId ? transports.get(sessionId) : undefined

    if (!transport) {
      // Nova sessão: criar servidor + transport
      const newSessionId = randomUUID()
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => newSessionId,
        onsessioninitialized: (id) => {
          transports.set(id, transport)
        },
      })
      const mcpServer = createMcpServer()
      await mcpServer.connect(transport)
    }

    const raw = await readBody(req)
    let body
    if (raw.length) {
      // Remove BOM (﻿) que alguns clientes/ferramentas prefixam
      const text = raw.toString('utf8').replace(/^﻿/, '').trim()
      try {
        body = text ? JSON.parse(text) : undefined
      } catch (err) {
        // JSON inválido NUNCA deve derrubar o servidor — responder 400
        console.warn('[MCP] JSON inválido no POST /mcp:', err.message)
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }))
        return
      }
    }
    await transport.handleRequest(req, res, body)
    return
  }

  if (req.method === 'GET') {
    const sessionId = req.headers['mcp-session-id']
    const transport = sessionId ? transports.get(sessionId) : undefined
    if (!transport) {
      res.writeHead(404)
      res.end('Session not found')
      return
    }
    await transport.handleRequest(req, res)
    return
  }

  if (req.method === 'DELETE') {
    const sessionId = req.headers['mcp-session-id']
    if (sessionId) {
      const transport = transports.get(sessionId)
      if (transport) {
        await transport.handleRequest(req, res)
        transports.delete(sessionId)
        return
      }
    }
    res.writeHead(204)
    res.end()
    return
  }

  res.writeHead(405)
  res.end('Method not allowed')
})

httpServer.listen(MCP_PORT, () => {
  console.log(`[rayzen-mcp-http] listening on port ${MCP_PORT}`)
  console.log(`[rayzen-mcp-http] API_URL: ${API_URL}`)
  console.log(`[rayzen-mcp-http] auth: OAuth 2.0 (client_id=${OAUTH_CLIENT_ID})`)
  console.log(`[rayzen-mcp-http] default projectId: ${DEFAULT_PID || '(none — must pass in each call)'}`)
})

// Defesa em profundidade: nenhum erro inesperado deve derrubar o servidor MCP.
// Antes, um JSON malformado ou falha de transport reiniciava o processo (indisponibilidade).
process.on('uncaughtException', (err) => {
  console.error('[rayzen-mcp-http] uncaughtException (ignorado):', err?.message ?? err)
})
process.on('unhandledRejection', (reason) => {
  console.error('[rayzen-mcp-http] unhandledRejection (ignorado):', reason?.message ?? reason)
})
