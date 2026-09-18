import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { fileURLToPath, pathToFileURL } from 'url'
import { dirname, join } from 'path'
import { statSync } from 'fs'
import { execSync } from 'child_process'
import { candidatosDeSlug } from '../repo-slug.mjs'

const __dir = dirname(fileURLToPath(import.meta.url))
const CONFIG_PATH = join(__dir, '../hooks/hook.config.mjs')

// O processo MCP (stdio) é de longa duração — sobrevive a várias sessões do
// Claude Code. Ler hook.config.mjs uma única vez no boot do processo causava
// "projectId não definido" sempre que o arquivo era corrigido sem reiniciar
// o processo (o fix nunca entrava em vigor até o próximo restart manual).
// Em vez disso, recarregamos o config sempre que o mtime do arquivo mudar —
// sem custo extra em chamadas subsequentes (apenas um stat() síncrono).
let cachedConfig = null
let cachedMtimeMs = -1

async function loadConfig() {
  let fileCfg = {}
  try {
    const { mtimeMs } = statSync(CONFIG_PATH)
    if (cachedConfig && mtimeMs === cachedMtimeMs) return cachedConfig

    // Query string com mtime invalida o cache de import() do Node para este
    // arquivo, forçando reavaliação mesmo que o specifier base já tenha sido importado.
    const fileUrl = `${pathToFileURL(CONFIG_PATH).href}?t=${mtimeMs}`
    const mod = await import(fileUrl)
    fileCfg = mod.default ?? {}
    cachedMtimeMs = mtimeMs
  } catch {
    // hook.config.mjs ausente ou inválido — segue com env vars apenas
  }

  const apiUrl = process.env.AGENT_API_URL ?? fileCfg.apiUrl ?? 'http://localhost:3001'
  cachedConfig = {
    apiUrl,
    apiV2Url:  process.env.AGENT_API_V2_URL ?? fileCfg.apiV2Url ?? apiUrl.replace(':3001', ':3002'),
    apiToken:  process.env.AGENT_TOKEN   ?? fileCfg.apiToken,
    projectId: process.env.PROJECT_ID ?? process.env.MCP_PROJECT_ID ?? fileCfg.projectId,
  }
  return cachedConfig
}

async function headers(extra = {}) {
  const cfg = await loadConfig()
  return { Authorization: `Bearer ${cfg.apiToken}`, 'Content-Type': 'application/json', ...extra }
}

// ── Resolução pelo repositório onde o Claude Code está ───────────────────────
//
// O MCP só sabia do PROJECT_ID fixado no ambiente, e é por isso que todo
// `.claude/settings.json` acabava com um ID cravado — configuração que envelhece
// mal: renomeou o repo, clonou, criou projeto novo, e o ID continua apontando
// para o projeto anterior, gravando dado no lugar errado sem avisar. Foi o
// incidente do blueprint "Urna" (2026-08-03).
//
// O hook já resolve pelo `repoSlug` do diretório. O MCP passa a fazer o mesmo,
// e o pin do ambiente vira só fallback legado. Assim, abrir outro projeto no
// mesmo VS Code separa sozinho, sem configurar nada.

const SLUG_TTL = 5 * 60 * 1000
let slugCache = { slug: null, id: null, ts: 0 }

// A resolução mora em `../repo-slug.mjs` — a mesma que o hook usa. Precisa ser a
// mesma, senão hook e MCP resolvem projetos diferentes no mesmo diretório.

async function projectIdPorRepo() {
  // Duas grafias possíveis, cru antes de kebab — ver `../repo-slug.mjs`.
  const candidatos = candidatosDeSlug()
  if (candidatos.length === 0) return null

  if (candidatos.includes(slugCache.slug) && Date.now() - slugCache.ts < SLUG_TTL) return slugCache.id

  try {
    const cfg = await loadConfig()
    for (const slug of candidatos) {
      const res = await fetch(`${cfg.apiUrl}/projects?repoSlug=${encodeURIComponent(slug)}`, {
        headers: await headers(),
      })
      if (!res.ok) continue
      const lista = await res.json()
      const id = Array.isArray(lista) && lista.length > 0 ? lista[0].id : null
      if (id) { slugCache = { slug, id, ts: Date.now() }; return id }
    }
    return null
  } catch {
    // Rede fora não pode virar "grava no projeto errado": sem resposta, sem id.
    return null
  }
}

async function resolveProjectId(args) {
  if (args.projectId && String(args.projectId).trim()) return args.projectId

  const porRepo = await projectIdPorRepo()
  if (porRepo) return porRepo

  const cfg = await loadConfig()
  const pid = cfg.projectId
  if (!pid || !String(pid).trim()) {
    throw new Error(
      'projectId não definido. Chame rayzen_list_projects para ver os projetos existentes, rayzen_create_project para criar um novo, ou informe projectId na tool.',
    )
  }
  return pid
}

// Leitura: cair no projectId padrão do ambiente é conveniência aceitável, mas NUNCA
// silenciosa — o resultado carrega um _warning pra quem chamou saber que os dados podem
// não ser do projeto que imaginava (ver incidente 2026-08-03: import de blueprint sem
// projectId explícito foi resolvido pro projeto errado e ninguém percebeu até tarde).
async function resolveProjectIdLoud(args) {
  const id = await resolveProjectId(args)
  if (args.projectId && String(args.projectId).trim()) return { id, usedDefault: false }

  // Resolvido pelo repositório não é "default do ambiente": veio de onde você
  // está de fato, que é o sinal mais confiável disponível. Avisar em toda
  // leitura seria o tipo de ruído que treina a ignorar o aviso que importa.
  const porRepo = await projectIdPorRepo()
  if (porRepo && porRepo === id) return { id, usedDefault: false }

  return { id, usedDefault: true }
}

function withWarning(result, usedDefault, id) {
  if (usedDefault && result && typeof result === 'object') {
    result._warning =
      `projectId não informado e o diretório atual não resolveu para nenhum projeto — ` +
      `usando o PROJECT_ID fixado no ambiente (${id}). Isso é fallback legado: confira se é ` +
      `mesmo o projeto certo, ou registre o repoSlug deste repositório no Rayzen.`
  }
  return result
}

// Escrita: nunca cai no default do ambiente. Adivinhar o projeto errado numa leitura só
// mostra dado desatualizado; numa escrita, corrompe outro projeto de forma silenciosa e
// persistente — foi exatamente isso que aconteceu no incidente do blueprint "Urna" gravado
// dentro do projeto Rayzen AI. projectId é sempre explícito aqui.
function requireProjectId(args) {
  const pid = args.projectId
  if (!pid || !String(pid).trim()) {
    throw new Error(
      'projectId obrigatório — esta operação grava dado e nunca usa o default do ambiente. Chame rayzen_list_projects pra achar o projeto certo, ou rayzen_create_project se for uma ideia nova.',
    )
  }
  return pid
}

async function api(method, path, body) {
  const cfg = await loadConfig()
  const res = await fetch(`${cfg.apiUrl}${path}`, {
    method,
    headers: await headers(),
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => res.status)
    throw new Error(`Rayzen API ${method} ${path} → ${res.status}: ${text}`)
  }
  return res.json().catch(() => null)
}

async function apiV2(method, path, body) {
  const cfg = await loadConfig()
  const res = await fetch(`${cfg.apiV2Url}${path}`, {
    method,
    headers: await headers(),
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => res.status)
    throw new Error(`Rayzen V2 API ${method} ${path} → ${res.status}: ${text}`)
  }
  return res.json().catch(() => null)
}

const TOOLS = [
  {
    name: 'rayzen_list_projects',
    description:
      'Lista os projetos existentes no Rayzen (id, nome, repoSlug, status, description). ' +
      // Ver o comentário gêmeo em `rayzen-mcp-http.mjs`: medido contra o Hermes em 13/09, o
      // `description` (texto de cadastro) foi usado para responder "qual o objetivo do projeto",
      // e estava desatualizado. O aviso vale igual aqui — este é o MCP que a sessão do Claude
      // Code usa.
      'ATENÇÃO: `description` é texto de cadastro, escrito na criação do projeto e frequentemente ' +
      'desatualizado. NÃO use `description` para responder sobre objetivo, foco, estado ou andamento — ' +
      'isso vem de rayzen_get_state (vigente) ou rayzen_get_resume (o que mudou). Esta tool serve para ' +
      'descobrir o projectId; o que o projeto É agora está em outro lugar. ' +
      'Use ANTES de importar um blueprint ou registrar algo ' +
      'pra confirmar o projectId certo — nunca adivinhe ou reaproveite um ID de outra tool sem confirmar.',
    inputSchema: {
      type: 'object',
      properties: {
        repoSlug: { type: 'string', description: 'Filtra por repoSlug (opcional)' },
      },
    },
  },
  {
    name: 'rayzen_create_project',
    description:
      'Cria um projeto novo no Rayzen e retorna o projectId real. Use quando a ideia/blueprint NÃO pertence a nenhum projeto ' +
      'existente — nunca importe um blueprint novo sem projectId torcendo pro default do ambiente resolver certo.',
    inputSchema: {
      type: 'object',
      required: ['name'],
      properties: {
        name: { type: 'string', description: 'Nome do projeto' },
        description: { type: 'string' },
        goals: { type: 'string' },
        repoSlug: { type: 'string', description: 'Opcional — auto-derivado do nome se omitido' },
      },
    },
  },
  {
    name: 'rayzen_create_goal',
    description:
      'Cria uma meta ativa no projeto com critérios de sucesso, e pausa a meta anterior. ' +
      'Use SEMPRE que um plano com objetivos for aprovado — é o que faz o plano existir no Rayzen em vez de só na conversa. ' +
      'Cada item do plano vira um critério; marcar os critérios ao longo do trabalho é o que move o objetivo do projeto.',
    inputSchema: {
      type: 'object',
      required: ['title', 'projectId'],
      properties: {
        projectId:   { type: 'string', description: 'ID do projeto — obrigatório, nunca usa default (esta tool grava dado)' },
        title:       { type: 'string', description: 'Título da meta, curto e verificável' },
        description: { type: 'string', description: 'O porquê da meta e o resultado esperado' },
        successCriteria: {
          type: 'array',
          description: 'Critérios de sucesso — o que precisa estar verdadeiro para a meta fechar',
          items: {
            type: 'object',
            required: ['text'],
            properties: {
              id:   { type: 'string', description: 'Identificador curto e estável (ex: "b1")' },
              text: { type: 'string' },
              done: { type: 'boolean', description: 'Padrão false' },
            },
          },
        },
        targetDate: { type: 'string', description: 'Data alvo em ISO (opcional)' },
      },
    },
  },
  {
    name: 'rayzen_get_state',
    description: 'Estado atual do projeto: objetivo, stage, milestones, blockers, riscos, próximos passos.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'ID do projeto (opcional — se omitido, usa o projeto padrão do ambiente e o resultado avisa em _warning)' },
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
        projectId: { type: 'string', description: 'ID do projeto (opcional — se omitido, usa o projeto padrão do ambiente e o resultado avisa em _warning)' },
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
        projectId: { type: 'string', description: 'ID do projeto (opcional — se omitido, usa o projeto padrão do ambiente e o resultado avisa em _warning)' },
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
      required: ['content', 'intent', 'projectId'],
      properties: {
        content: { type: 'string', description: 'Descrição do evento' },
        intent: {
          type: 'string',
          enum: ['decision', 'idea', 'problem', 'reference'],
          description: 'Tipo do evento',
        },
        projectId: { type: 'string', description: 'ID do projeto — obrigatório, nunca usa default (esta tool grava dado)' },
      },
    },
  },
  {
    name: 'rayzen_checkpoint',
    description: 'Cria um checkpoint de sessão: sintetiza o que foi feito, decisões, próximos passos.',
    inputSchema: {
      type: 'object',
      required: ['projectId'],
      properties: {
        projectId: { type: 'string', description: 'ID do projeto — obrigatório, nunca usa default (esta tool grava dado)' },
        sessionId: { type: 'string', description: 'ID da sessão (opcional)' },
      },
    },
  },
  {
    name: 'rayzen_update_planning',
    description: 'Atualiza o planejamento do projeto: milestones, blockers, próximos passos.',
    inputSchema: {
      type: 'object',
      required: ['projectId'],
      properties: {
        projectId: { type: 'string', description: 'ID do projeto — obrigatório, nunca usa default (esta tool grava dado)' },
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
      'Importa um Blueprint completo para o projeto: cria páginas Wiki, indexa no Brain, registra eventos e atualiza o planejamento. ' +
      'Se o blueprint é de uma ideia nova sem projeto ainda, chame rayzen_create_project ANTES — nunca importe sem projectId esperando que o ambiente acerte o projeto certo.',
    inputSchema: {
      type: 'object',
      required: ['title', 'content', 'format', 'source', 'projectId'],
      properties: {
        projectId: { type: 'string', description: 'ID do projeto — obrigatório, nunca usa default (esta tool grava dado)' },
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
      'Atalho para importar um planejamento Markdown diretamente para um projeto com todas as opções ativas. ' +
      'Se for uma ideia nova sem projeto ainda, chame rayzen_create_project ANTES — nunca importe sem projectId esperando que o ambiente acerte o projeto certo.',
    inputSchema: {
      type: 'object',
      required: ['title', 'markdown', 'projectId'],
      properties: {
        projectId: { type: 'string', description: 'ID do projeto — obrigatório, nunca usa default (esta tool grava dado)' },
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
      required: ['title', 'problem', 'solution', 'projectId'],
      properties: {
        title: { type: 'string', description: 'Título curto e buscável (ex: "Deploy Rayzen no servidor")' },
        problem: { type: 'string', description: 'O que quebrou / o sintoma observado' },
        solution: { type: 'string', description: 'Como foi resolvido — passos concretos e reproduzíveis' },
        type: {
          type: 'string',
          enum: ['runbook', 'troubleshooting', 'decision', 'pattern', 'gotcha'],
          description: 'Tipo do aprendizado (padrão: troubleshooting)',
        },
        tags: { type: 'array', items: { type: 'string' }, description: 'Tags para recuperação, ex: ["deploy","docker"]' },
        projectId: { type: 'string', description: 'ID do projeto — obrigatório, nunca usa default (esta tool grava dado no Brain)' },
      },
    },
  },
  {
    name: 'rayzen_get_context',
    description:
      'Monta um pacote cirúrgico de contexto para a tarefa atual: ProjectState, meta ativa, planejamento, blockers e memória semântica relevante. Use no início de tarefas de implementação, debugging ou revisão para receber só o contexto que importa — evita re-explicar o estado do projeto. ' +
      // Ver o comentário gêmeo em `rayzen-mcp-http.mjs`: a cadeia POST /v2/context/build →
      // ContextEngine → MemoryService.search → trackAccess incrementa acesso e promove classe.
      'NOTA DE EFEITO: esta consulta registra acesso à memória e pode promover a classe de um ' +
      'documento (inbox → working) a partir de 3 acessos, o que altera o ranking de buscas ' +
      'futuras. Não é uma leitura neutra. Para consultar sem esse efeito, use rayzen_search_memory ' +
      '(Brain V1, sem contabilização de acesso).',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'ID do projeto (opcional — se omitido, usa o projeto padrão do ambiente e o resultado avisa em _warning)' },
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
        projectId: { type: 'string', description: 'ID do projeto (opcional — se omitido, usa o projeto padrão do ambiente e o resultado avisa em _warning)' },
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
    name: 'rayzen_guardian_status',
    description:
      'Retorna o último GuardianReport do projeto: riskLevel, riskScore, arquivos sem spec e recomendação de deploy. ' +
      'Use para checar o estado atual de saúde do código antes de um push ou ao início de uma sessão de implementação. ' +
      'Retorna null se não houver reports ainda.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'ID do projeto (opcional — se omitido, usa o projeto padrão do ambiente e o resultado avisa em _warning)' },
      },
    },
  },
  {
    name: 'rayzen_guardian_analyze',
    description:
      'Dispara uma análise Guardian para arquivos alterados e retorna o GuardianReport imediatamente. ' +
      'Use após modificar arquivos para obter o risk assessment sem esperar o workspace-watcher (30s). ' +
      'Especialmente útil antes de um push ou quando o workspace-watcher não está rodando.',
    inputSchema: {
      type: 'object',
      required: ['changedFiles', 'projectId'],
      properties: {
        projectId:    { type: 'string',   description: 'ID do projeto — obrigatório, nunca usa default (esta tool grava um GuardianReport)' },
        changedFiles: { type: 'array',    items: { type: 'string' }, description: 'Lista de arquivos alterados (caminhos relativos)' },
        repoPath:     { type: 'string',   description: 'Caminho absoluto do repositório (opcional)' },
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
        projectId: { type: 'string', description: 'ID do projeto (opcional — sem ele o plano é gerado sem contexto de projeto, nunca usa default do ambiente). Se for importar com autoImport, projectId é obrigatório.' },
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
    let result

    switch (name) {
      case 'rayzen_list_projects': {
        const projects = await api('GET', '/projects' + (args.repoSlug ? `?repoSlug=${encodeURIComponent(args.repoSlug)}` : ''))
        result = projects
        break
      }

      case 'rayzen_create_project':
        result = await api('POST', '/projects', {
          name: args.name,
          description: args.description,
          goals: args.goals,
          repoSlug: args.repoSlug,
        })
        break

      case 'rayzen_create_goal': {
        const projectId = requireProjectId(args)
        result = await api('POST', `/projects/${projectId}/graph/goal`, {
          title:           args.title,
          description:     args.description,
          successCriteria: args.successCriteria ?? [],
          targetDate:      args.targetDate,
        })
        break
      }

      case 'rayzen_get_state': {
        const { id, usedDefault } = await resolveProjectIdLoud(args)
        result = withWarning(await api('GET', `/projects/${id}/state`), usedDefault, id)
        break
      }

      case 'rayzen_get_resume': {
        const { id, usedDefault } = await resolveProjectIdLoud(args)
        result = withWarning(await api('POST', `/projects/${id}/resume`, {}), usedDefault, id)
        break
      }

      case 'rayzen_get_events': {
        const { id, usedDefault } = await resolveProjectIdLoud(args)
        const limit = args.limit ?? 20
        const intent = args.intent ? `&intent=${args.intent}` : ''
        result = withWarning(await api('GET', `/events?project_id=${id}&limit=${limit}${intent}`), usedDefault, id)
        break
      }

      case 'rayzen_search_memory': {
        const { id, usedDefault } = await resolveProjectIdLoud(args)
        result = withWarning(await api('POST', '/brain/search', {
          query: args.query,
          projectId: id,
          limit: args.limit ?? 5,
        }), usedDefault, id)
        break
      }

      case 'rayzen_get_goal': {
        const { id, usedDefault } = await resolveProjectIdLoud(args)
        result = withWarning(await api('GET', `/projects/${id}/graph/goal`), usedDefault, id)
        break
      }

      case 'rayzen_capture_learning':
        result = await api('POST', '/wiki/learning', {
          title:     args.title,
          problem:   args.problem,
          solution:  args.solution,
          type:      args.type,
          tags:      args.tags,
          projectId: requireProjectId(args),
        })
        break

      case 'rayzen_get_context': {
        const { id, usedDefault } = await resolveProjectIdLoud(args)
        result = withWarning(await apiV2('POST', '/v2/context/build', {
          projectId: id,
          mode: args.mode ?? 'implementation',
          query: args.query,
          maxTokens: args.maxTokens ?? 4000,
        }), usedDefault, id)
        break
      }

      case 'rayzen_list_specialists': {
        const { id, usedDefault } = await resolveProjectIdLoud(args)
        result = withWarning(await apiV2('GET', `/v2/specialist-agents?projectId=${id}`), usedDefault, id)
        break
      }

      case 'rayzen_get_wiki':
        result = await api('GET', `/wiki/${encodeURIComponent(args.slug)}`)
        break

      case 'rayzen_add_event':
        result = await api('POST', '/events/cli', {
          content: args.content,
          intent: args.intent,
          projectId: requireProjectId(args),
          source: 'claude-mcp',
          type: 'note',
        })
        break

      case 'rayzen_checkpoint': {
        const projectId = requireProjectId(args)
        const [checkpoint, goalProposals] = await Promise.all([
          api('POST', '/synthesis/checkpoint', { projectId, sessionId: args.sessionId }),
          api('POST', `/projects/${projectId}/graph/goal/propose-progress`, {}).catch(() => null),
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
          lines.push(`\nPara marcar: PATCH /projects/${projectId}/graph/goal/${goalProposals.goalId}/criteria/<criteriaId> com {"done":true}`)
          result._proposalsSummary = lines.join('\n')
        }
        break
      }

      case 'rayzen_update_planning': {
        const projectId = requireProjectId(args)
        const patch = {}
        if (args.milestones) {
          // Merge em vez de substituir a lista inteira — updatePlanning() na API faz
          // replace bruto do campo; um patch parcial (ex: 1 milestone) apagava os
          // outros que já existiam. Ver memory/project-predeploy-hardening.md.
          //
          // A chave é o TÍTULO normalizado, não o `id`. Desde que o backlog deixou de
          // pedir `id` ao LLM, o chamador correto manda só `title` — e o merge por id
          // fazia `merged.set(undefined, …)` para todos, colapsando a lista numa
          // entrada só: de 4 milestones enviados, sobrevivia **o último**. Silencioso,
          // com HTTP 200 e resposta de sucesso.
          //
          // Mesma normalização do `titleKey()` da API, senão os dois lados discordam
          // sobre o que é "o mesmo milestone" — título é a identidade, id é derivado.
          const chaveMilestone = (m) => {
            const t = String(m?.title ?? '')
              .toLowerCase()
              .normalize('NFD')
              .replace(/[\u0300-\u036f]/g, '')
              .replace(/[^a-z0-9]+/g, ' ')
              .trim()
            return t ? `t:${t}` : `id:${String(m?.id ?? '')}`
          }
          const current = await api('GET', `/projects/${projectId}/state`)
          const merged = new Map((current.milestones ?? []).map((m) => [chaveMilestone(m), m]))
          for (const m of args.milestones) {
            const k = chaveMilestone(m)
            merged.set(k, { ...merged.get(k), ...m })
          }
          patch.milestones = [...merged.values()]
        }
        if (args.blockers) patch.blockers = args.blockers
        if (args.nextSteps) patch.nextSteps = args.nextSteps
        result = await api('PATCH', `/projects/${projectId}/state/planning`, patch)
        break
      }

      case 'rayzen_blueprint_preview':
        // Preview não persiste nada e a API ignora projectId — passa direto, sem default.
        result = await api('POST', '/blueprint/preview', {
          projectId: args.projectId,
          title: args.title,
          content: args.content,
          format: args.format ?? 'markdown',
        })
        break

      case 'rayzen_blueprint_import':
        result = await api('POST', '/blueprint/import', {
          projectId: requireProjectId(args),
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
          projectId: requireProjectId(args),
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
        // Geração de plano é read-ish (só grava um ConversationMessage de log) — projectId
        // é opcional de verdade e passa direto, sem cair no default do ambiente (isso
        // enviesaria o plano com contexto de um projeto errado).
        const plan = await api('POST', '/blueprint/plan', {
          feature: args.feature,
          projectId: args.projectId,
          context: args.context,
          mode: args.mode ?? 'implementation',
        })

        if (args.autoImport && plan?.markdown) {
          const importResult = await api('POST', '/blueprint/import', {
            projectId: requireProjectId(args),
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

      case 'rayzen_guardian_status': {
        const { id, usedDefault } = await resolveProjectIdLoud(args)
        const report = await apiV2('GET', `/v2/guardian/latest/${id}`).catch(() => null)
        if (!report) {
          result = withWarning({ status: 'no_reports', message: 'Nenhum GuardianReport encontrado para este projeto.' }, usedDefault, id)
          break
        }
        // Retorna só o essencial para não poluir o contexto do Claude
        result = withWarning({
          id:                report.id,
          riskLevel:         report.riskLevel,
          riskScore:         report.riskScore,
          deployRecommend:   report.deployRecommend,
          summary:           report.summary,
          filesWithoutTests: report.filesWithoutTests ?? [],
          suggestedTests:    (report.suggestedTests ?? []).slice(0, 5),
          changedFiles:      (report.changedFiles ?? []).slice(0, 8),
          overridden:        report.overridden,
          createdAt:         report.createdAt,
        }, usedDefault, id)
        break
      }

      case 'rayzen_guardian_analyze': {
        const cfg = await loadConfig()
        result = await apiV2('POST', '/v2/guardian/analyze', {
          projectId:    requireProjectId(args),
          repoPath:     args.repoPath ?? cfg.repoPath ?? '',
          changedFiles: args.changedFiles ?? [],
          allFiles:     [],
        })
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
