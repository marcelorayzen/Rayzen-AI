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

// Env vars take precedence — allows extract_from_client projects to inject credentials
// via .claude/settings.json without needing a hook.config.mjs
const apiUrl          = process.env.AGENT_API_URL  || cfg.apiUrl
const apiToken        = process.env.AGENT_TOKEN    || cfg.apiToken
const defaultProjectId = process.env.PROJECT_ID || process.env.MCP_PROJECT_ID || cfg.projectId

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
  {
    name: 'rayzen_capture_learning',
    description:
      'Grava um aprendizado estruturado DEPOIS de resolver um problema (runbook de deploy, troubleshooting, gotcha, decisão, padrão). ' +
      'Indexa no Brain com escopo de projeto — assim o aprendizado RESSURGE sozinho em rayzen_get_context e rayzen_search_memory na próxima vez que o problema aparecer. ' +
      'Use ao final de um conserto não-trivial para o erro não se repetir sem memória da solução. Fecha o loop: você executa, o Rayzen lembra.',
    inputSchema: {
      type: 'object',
      required: ['title', 'problem', 'solution'],
      properties: {
        title: { type: 'string', description: 'Título curto e buscável (ex: "Deploy Rayzen no notebook")' },
        problem: { type: 'string', description: 'O que quebrou / o sintoma observado' },
        solution: { type: 'string', description: 'Como foi resolvido — passos concretos e reproduzíveis' },
        type: {
          type: 'string',
          enum: ['runbook', 'troubleshooting', 'decision', 'pattern', 'gotcha'],
          description: 'Tipo do aprendizado (padrão: troubleshooting)',
        },
        tags: { type: 'array', items: { type: 'string' }, description: 'Tags para recuperação, ex: ["deploy","docker"]' },
        projectId: { type: 'string', description: 'ID do projeto (opcional, usa o padrão do hook.config)' },
      },
    },
  },
  {
    name: 'rayzen_get_context',
    description:
      'Monta um pacote cirúrgico de contexto para a tarefa atual: ProjectState, meta ativa, planejamento, blockers e memória semântica relevante. Use no início de tarefas de implementação, debugging ou revisão para receber só o contexto que importa — evita re-explicar o estado do projeto.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'ID do projeto (opcional, usa o padrão do hook.config)' },
        mode: {
          type: 'string',
          enum: ['implementation', 'debugging', 'review', 'architecture', 'study'],
          description: 'Modo de trabalho — determina quais seções são incluídas (padrão: implementation)',
        },
        query: { type: 'string', description: 'Consulta semântica para buscar memória relevante no Brain' },
        maxTokens: { type: 'number', description: 'Limite de tokens do contexto gerado (padrão: 4000)' },
      },
    },
  },
  {
    name: 'rayzen_list_specialists',
    description:
      'Lista os Specialist Agents disponíveis para o projeto: backend, QA, infra, devops, general e overrides por projeto. Use para descobrir quais especialistas estão ativos antes de criar uma missão.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'ID do projeto (opcional, usa o padrão do hook.config)' },
      },
    },
  },
  {
    name: 'rayzen_agent_task',
    description:
      'Despacha uma tarefa para o agent desktop executar (screenshot, navegação, terminal, git, etc). ' +
      'Aguarda resultado por até 20s. Use para ações que precisam rodar localmente no PC do usuário.',
    inputSchema: {
      type: 'object',
      required: ['action'],
      properties: {
        action: {
          type: 'string',
          description: 'Ação no formato módulo:nome, ex: jarvis:screenshot, jarvis:browse_and_screenshot, jarvis:run_command, jarvis:git_status',
        },
        payload: {
          type: 'object',
          description: 'Parâmetros da ação. Ex para browse_and_screenshot: { url, label, waitMs, projectName }',
        },
        targetRole: {
          type: 'string',
          enum: ['desktop', 'server'],
          description: 'Role alvo (padrão: desktop)',
        },
        waitResult: {
          type: 'boolean',
          description: 'Aguardar resultado síncrono (padrão: true, timeout 20s)',
        },
      },
    },
  },
  {
    name: 'rayzen_blueprint_create_feature_plan',
    description:
      'Gera um Blueprint Markdown estruturado para uma feature usando o contexto do ProjectState do projeto. Use ANTES de implementar uma feature nova para planejar e depois importar com rayzen_blueprint_import_markdown.',
    inputSchema: {
      type: 'object',
      required: ['feature'],
      properties: {
        feature: { type: 'string', description: 'Descrição da feature ou ideia a planejar (pode ser bruta ou detalhada)' },
        projectId: { type: 'string', description: 'ID do projeto (opcional, usa o padrão do hook.config)' },
        context: { type: 'string', description: 'Contexto adicional: stack, restrições, integrações existentes' },
        mode: {
          type: 'string',
          enum: ['architecture', 'implementation', 'debugging', 'review', 'study'],
          description: 'Modo do Blueprint (padrão: implementation)',
        },
        autoImport: {
          type: 'boolean',
          description: 'Se true, importa automaticamente após gerar o plano (padrão: false — mostra o plano primeiro)',
        },
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

      case 'rayzen_capture_learning':
        result = await api('POST', '/wiki/learning', {
          title:     args.title,
          problem:   args.problem,
          solution:  args.solution,
          type:      args.type,
          tags:      args.tags,
          projectId: pid(),
        })
        break

      case 'rayzen_get_context':
        result = await api('POST', '/v2/context/build', {
          projectId: pid(),
          mode: args.mode ?? 'implementation',
          query: args.query,
          maxTokens: args.maxTokens ?? 4000,
        })
        break

      case 'rayzen_list_specialists':
        result = await api('GET', `/v2/specialist-agents?projectId=${pid()}`)
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

      case 'rayzen_checkpoint': {
        const [checkpoint, goalProposals] = await Promise.all([
          api('POST', '/synthesis/checkpoint', { projectId: pid(), sessionId: args.sessionId }),
          api('POST', `/projects/${pid()}/graph/goal/propose-progress`, {}).catch(() => null),
        ])
        result = { ...checkpoint }
        if (goalProposals?.proposals?.length) {
          result.goalProposals = goalProposals
          const lines = [`\n### Progresso do Goal: "${goalProposals.goalTitle}"`]
          lines.push(`${goalProposals.proposals.length} critério(s) possivelmente concluído(s) nesta sessão:`)
          for (const p of goalProposals.proposals) {
            const badge = p.confidence === 'high' ? '🟢' : p.confidence === 'medium' ? '🟡' : '🟠'
            lines.push(`${badge} [${p.criteriaId}] ${p.text}`)
            lines.push(`   → ${p.reason}`)
          }
          lines.push(`\nPara marcar: PATCH /projects/${pid()}/graph/goal/${goalProposals.goalId}/criteria/<criteriaId> com {"done":true}`)
          result._proposalsSummary = lines.join('\n')
        }
        break
      }

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
          projectId: args.projectId ?? defaultProjectId ?? undefined,
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

      case 'rayzen_agent_task': {
        const rawAction  = args.action ?? ''
        const colonIdx   = rawAction.indexOf(':')
        const module     = colonIdx > 0 ? rawAction.slice(0, colonIdx) : 'jarvis'
        const actionName = colonIdx > 0 ? rawAction.slice(colonIdx + 1) : rawAction
        const waitResult = args.waitResult !== false

        const task = await api('POST', '/tasks', {
          module,
          action:     actionName,
          payload:    args.payload ?? {},
          targetRole: args.targetRole ?? 'desktop',
        })

        if (!waitResult) {
          result = { taskId: task.id, status: 'dispatched' }
          break
        }

        // Poll for result (max 20s, interval 2s)
        let polled = null
        for (let i = 0; i < 10; i++) {
          await new Promise((r) => setTimeout(r, 2000))
          const current = await api('GET', `/tasks/${task.id}`).catch(() => null)
          if (current?.status === 'done' || current?.status === 'failed') {
            polled = current
            break
          }
        }
        result = polled ?? { taskId: task.id, status: 'timeout', note: 'Agent não respondeu em 20s — verifique se o agent está rodando' }
        break
      }

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
