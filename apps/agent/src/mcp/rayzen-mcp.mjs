import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { fileURLToPath, pathToFileURL } from 'url'
import { dirname, join } from 'path'

const __dir = dirname(fileURLToPath(import.meta.url))
const cfgPath = pathToFileURL(join(__dir, '../hooks/hook.config.mjs')).href
const { default: cfg } = await import(cfgPath)

const { apiUrl, apiToken, projectId: defaultProjectId } = cfg

function headers(extra = {}) {
  return { Authorization: `Bearer ${apiToken}`, 'Content-Type': 'application/json', ...extra }
}

function resolveProjectId(args) {
  const pid = args.projectId ?? defaultProjectId
  if (!pid || !String(pid).trim()) {
    throw new Error(
      'projectId não definido. Configure projectId no hook.config.mjs ou informe projectId na tool MCP.',
    )
  }
  return pid
}

async function api(method, path, body) {
  const res = await fetch(`${apiUrl}${path}`, {
    method,
    headers: headers(),
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => res.status)
    throw new Error(`Rayzen API ${method} ${path} → ${res.status}: ${text}`)
  }
  return res.json().catch(() => null)
}

const TOOLS = [
  {
    name: 'rayzen_get_state',
    description: 'Estado atual do projeto: objetivo, stage, milestones, blockers, riscos, próximos passos.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'ID do projeto (opcional, usa o padrão do hook.config)' },
      },
    },
  },
  {
    name: 'rayzen_get_resume',
    description: 'Brief de retomada: o que mudou desde a última sessão, blockers ativos, próximo passo recomendado.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
      },
    },
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
        query: { type: 'string', description: 'Texto da busca' },
        projectId: { type: 'string' },
        limit: { type: 'number', description: 'Número de resultados (padrão: 5)' },
      },
    },
  },
  {
    name: 'rayzen_get_goal',
    description: 'Meta ativa do projeto com critérios de sucesso, KPIs, gap analysis e Next Best Action.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
      },
    },
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
        content: { type: 'string', description: 'Descrição do evento' },
        intent: {
          type: 'string',
          enum: ['decision', 'idea', 'problem', 'reference'],
          description: 'Tipo do evento',
        },
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
        sessionId: { type: 'string', description: 'ID da sessão (opcional)' },
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
    description:
      'Analisa um Blueprint em Markdown ou JSON e retorna o que seria criado sem salvar nada. Use antes do import para validar.',
    inputSchema: {
      type: 'object',
      required: ['title', 'content', 'format'],
      properties: {
        projectId: { type: 'string' },
        title: { type: 'string', description: 'Título do blueprint' },
        content: { type: 'string', description: 'Conteúdo em Markdown ou JSON' },
        format: { type: 'string', enum: ['markdown', 'json'], description: 'Formato do conteúdo' },
      },
    },
  },
  {
    name: 'rayzen_blueprint_import',
    description:
      'Importa um Blueprint completo para o projeto: cria páginas Wiki, indexa no Brain, registra eventos e atualiza o planejamento.',
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
    description:
      'Atalho para importar um planejamento Markdown diretamente para o projeto atual com todas as opções ativas.',
    inputSchema: {
      type: 'object',
      required: ['title', 'markdown'],
      properties: {
        projectId: { type: 'string' },
        title: { type: 'string', description: 'Título do plano' },
        markdown: { type: 'string', description: 'Conteúdo em Markdown' },
        source: { type: 'string', enum: ['chatgpt', 'claude', 'manual', 'github', 'notion'] },
        overwriteWiki: { type: 'boolean' },
      },
    },
  },
]

const server = new Server(
  { name: 'rayzen', version: '1.0.0' },
  { capabilities: { tools: {} } },
)

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }))

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args = {} } = req.params

  try {
    // pid resolvido por cada case que precisa — tools sem projectId (wiki, brain search) usam args direto
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
          source: 'claude-mcp',
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

      default:
        throw new Error(`Tool desconhecida: ${name}`)
    }

    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    }
  } catch (err) {
    return {
      content: [{ type: 'text', text: `Erro: ${err.message}` }],
      isError: true,
    }
  }
})

const transport = new StdioServerTransport()
await server.connect(transport)
