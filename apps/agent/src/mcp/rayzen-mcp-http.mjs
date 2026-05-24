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

const API_URL        = process.env.AGENT_API_URL  ?? 'http://api:3001'
const API_TOKEN      = process.env.AGENT_TOKEN    ?? ''
const MCP_TOKEN      = process.env.MCP_TOKEN      ?? ''
const MCP_PORT       = Number(process.env.MCP_PORT ?? 3102)
const DEFAULT_PID    = process.env.MCP_PROJECT_ID ?? ''

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
  if (!MCP_TOKEN) return true // sem token configurado = aberto (não recomendado em prod)
  const auth = req.headers['authorization'] ?? ''
  if (auth !== `Bearer ${MCP_TOKEN}`) {
    res.writeHead(401, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Unauthorized' }))
    return false
  }
  return true
}

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

  // Health check (sem auth)
  if (req.method === 'GET' && url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true, service: 'rayzen-mcp-http', port: MCP_PORT }))
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
    const body = raw.length ? JSON.parse(raw.toString()) : undefined
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
  console.log(`[rayzen-mcp-http] auth: ${MCP_TOKEN ? 'enabled' : 'DISABLED — set MCP_TOKEN'}`)
  console.log(`[rayzen-mcp-http] default projectId: ${DEFAULT_PID || '(none — must pass in each call)'}`)
})
