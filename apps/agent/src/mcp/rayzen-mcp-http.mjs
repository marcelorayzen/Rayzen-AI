/**
 * Rayzen MCP — HTTP/SSE transport (Claude Desktop)
 *
 * Expõe os tools equivalentes ao rayzen-mcp.mjs via HTTP Streamable,
 * para ser consumido pelo Claude Desktop/claude.ai como conector personalizado.
 *
 * projectId: tools de escrita (blueprint_import*, add_event, checkpoint, update_planning,
 * capture_learning) NUNCA caem no MCP_PROJECT_ID default — exigem projectId explícito.
 * Tools de leitura podem cair no default, mas o resultado sempre inclui um campo
 * `_warning` quando isso acontece. Use rayzen_list_projects / rayzen_create_project em vez
 * de confiar no default (ver incidente 2026-08-03: import sem projectId gravou dentro do
 * projeto errado silenciosamente).
 *
 * Env vars:
 *   AGENT_API_URL        — URL da API Rayzen  (default: http://api:3001)
 *   AGENT_TOKEN          — Bearer token para a API Rayzen
 *   MCP_TOKEN            — Bearer token que o cliente (Claude Desktop) deve enviar
 *   MCP_PORT             — Porta de escuta (default: 3102)
 *   MCP_PROJECT_ID       — projectId padrão só para tools de LEITURA quando o cliente não informa
 *   GITHUB_WEBHOOK_SECRET — HMAC secret do webhook GitHub (POST /webhook/github-build)
 *   WEBHOOK_DEPLOY_HOST   — host SSH para build remoto (default: rayzen@servidor-local)
 *   WEBHOOK_DEPLOY_KEY    — chave privada SSH dedicada e restrita por forced-command
 *   MCP_READONLY_TOKEN    — token de leitura COMPARTILHADO, sem identidade — mantido por
 *                           compatibilidade (ver Fase 8 do plano de execução tipada)
 *   MCP_TOKEN_<NOME>      — token de leitura POR CONSUMIDOR (ex.: MCP_TOKEN_HERMES): mesmo
 *                           escopo do `MCP_READONLY_TOKEN`, mas com nome no log de acesso e
 *                           revogável sozinho — apagar uma variável não derruba as outras
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { createServer } from 'node:http'
import { randomUUID, createHmac, timingSafeEqual } from 'node:crypto'
import { execFile } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const MCP_PORT            = Number(process.env.MCP_PORT     ?? 3102)
const ADMIN_PASSWORD      = process.env.ADMIN_PASSWORD      ?? ''
const OAUTH_CLIENT_ID     = process.env.OAUTH_CLIENT_ID     ?? 'claude-ai'
const OAUTH_CLIENT_SECRET = process.env.OAUTH_CLIENT_SECRET ?? ''
const MCP_BASE_URL        = (process.env.MCP_BASE_URL       ?? 'https://rayzen.com.br').replace(/\/$/, '')
const GITHUB_WEBHOOK_SECRET = process.env.GITHUB_WEBHOOK_SECRET ?? ''
const WEBHOOK_DEPLOY_HOST   = process.env.WEBHOOK_DEPLOY_HOST   ?? 'rayzen@servidor-local'
const WEBHOOK_DEPLOY_KEY    = process.env.WEBHOOK_DEPLOY_KEY    ?? '/run/secrets/webhook_deploy_key'

// ── GitHub webhook → build automático (push em main) ───────────────────────
// A chave SSH usada aqui é dedicada e restrita via forced-command no
// authorized_keys do host — mesmo que este handler tenha um bug, ela só
// consegue rodar "git pull && docker compose build web api api-v2".
function verifyGithubSignature(rawBody, signatureHeader) {
  if (!GITHUB_WEBHOOK_SECRET || !signatureHeader?.startsWith('sha256=')) return false
  const expected = createHmac('sha256', GITHUB_WEBHOOK_SECRET).update(rawBody).digest('hex')
  const expectedBuf = Buffer.from(`sha256=${expected}`)
  const actualBuf   = Buffer.from(signatureHeader)
  if (expectedBuf.length !== actualBuf.length) return false
  return timingSafeEqual(expectedBuf, actualBuf)
}

function triggerRemoteBuild() {
  execFile(
    'ssh',
    ['-i', WEBHOOK_DEPLOY_KEY, '-o', 'StrictHostKeyChecking=accept-new', WEBHOOK_DEPLOY_HOST],
    { timeout: 600_000 },
    (err, stdout, stderr) => {
      if (err) {
        console.error('[webhook] build remoto falhou:', err.message, stderr?.toString().slice(0, 2000))
        return
      }
      console.log('[webhook] build remoto concluído:', stdout?.toString().slice(0, 2000))
    },
  )
}

// ── Config resolvido sob demanda (paridade com rayzen-mcp.mjs stdio) ──────────
// Env vars têm prioridade (deploy Docker 12-factor — atualiza via restart do
// container). Se hook.config.mjs existir (execução local ou volume montado), é
// recarregado quando o mtime muda — sem custo extra (apenas um stat() síncrono).
const __dir = dirname(fileURLToPath(import.meta.url))
const CONFIG_PATH = join(__dir, '../hooks/hook.config.mjs')

let cachedConfig = null
let cachedMtimeMs = -1

async function loadConfig() {
  let fileCfg = {}
  try {
    const { mtimeMs } = statSync(CONFIG_PATH)
    if (cachedConfig && mtimeMs === cachedMtimeMs) return cachedConfig
    const fileUrl = `${pathToFileURL(CONFIG_PATH).href}?t=${mtimeMs}`
    const mod = await import(fileUrl)
    fileCfg = mod.default ?? {}
    cachedMtimeMs = mtimeMs
  } catch {
    // hook.config.mjs ausente (caso Docker) ou inválido — usa só env vars
    if (cachedConfig) return cachedConfig
  }
  const apiUrl = process.env.AGENT_API_URL || fileCfg.apiUrl || 'http://api:3001'
  cachedConfig = {
    apiUrl,
    apiV2Url:  process.env.AGENT_API_V2_URL || fileCfg.apiV2Url || apiUrl.replace(':3001', ':3002'),
    apiToken:  process.env.AGENT_TOKEN    || fileCfg.apiToken  || '',
    projectId: process.env.MCP_PROJECT_ID || fileCfg.projectId || '',
  }
  return cachedConfig
}

// ── Token persistence ────────────────────────────────────────────────────────
const TOKEN_FILE = join('/app/storage/mcp', 'tokens.json')

function loadPersistedTokens() {
  try {
    mkdirSync(dirname(TOKEN_FILE), { recursive: true })
    const raw = readFileSync(TOKEN_FILE, 'utf-8')
    const data = JSON.parse(raw)
    const map = new Map(Object.entries(data))
    // Remove expired.
    //
    // Aceita as DUAS formas: o número puro dos tokens gravados antes do escopo existir,
    // e o `{ exp, escopo }` de agora. A primeira versão desta mudança comparava o objeto
    // com um número (`v < now`), o que é sempre falso — token expirado nunca seria
    // podado e o arquivo cresceria para sempre.
    const now = Date.now()
    for (const [k, v] of map) {
      const exp = typeof v === 'number' ? v : v?.exp
      if (!exp || exp < now) map.delete(k)
    }
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

const ESCOPO_TOTAL   = 'total'
const ESCOPO_LEITURA = 'leitura'

/** Token estático de leitura, para consumidor que não faz o fluxo OAuth. */
const MCP_READONLY_TOKEN = process.env.MCP_READONLY_TOKEN ?? ''

/**
 * Fase 8 do plano de execução tipada — token por consumidor, no lugar de UM token de leitura
 * compartilhado. Hoje `MCP_READONLY_TOKEN` não diz QUEM leu o quê, e revogar um consumidor
 * (Hermes, por exemplo) derrubaria qualquer outro que apresentasse o mesmo valor — não há
 * como distinguir.
 *
 * `MCP_TOKEN_<NOME>` — uma variável de ambiente por consumidor, descoberta em `process.env`
 * em vez de uma lista fixa: o compose já declara variável a variável (nunca `env_file`, ver o
 * aviso da `GEMINI_API_KEY` em `CLAUDE.md`), e um consumidor novo só precisa de uma linha nova
 * no compose, sem tocar neste arquivo. Mesmo escopo de `MCP_READONLY_TOKEN` (leitura) — a
 * Fase 8 é aditiva por decisão do plano, não introduz um escopo novo.
 */
const CONSUMIDORES_LEITURA = Object.entries(process.env)
  .filter(([chave, valor]) => /^MCP_TOKEN_[A-Z0-9_]+$/.test(chave) && valor)
  .map(([chave, valor]) => ({ nome: chave.slice('MCP_TOKEN_'.length).toLowerCase(), token: valor }))

/**
 * Só para o LOG de acesso — nunca decide autorização (`escopoDoToken` já fez isso). Devolve o
 * nome do consumidor quando o token é um `MCP_TOKEN_<NOME>`, `'compartilhado'` quando é o
 * `MCP_READONLY_TOKEN` legado (sem nome, de propósito — é o próprio problema que esta fase
 * resolve), ou `null` para token OAuth (esses já têm identidade própria no arquivo persistido,
 * só não têm NOME humano).
 */
function identificarConsumidor(token) {
  if (!token) return null
  const consumidor = CONSUMIDORES_LEITURA.find((c) => c.token === token)
  if (consumidor) return consumidor.nome
  if (MCP_READONLY_TOKEN && token === MCP_READONLY_TOKEN) return 'compartilhado'
  return null
}

function ehSomenteLeitura(escopo) {
  return escopo === ESCOPO_LEITURA
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
  accessTokens.set(token, { exp: Date.now() + TOKEN_TTL, escopo: ESCOPO_TOTAL })
  saveTokens(accessTokens)   // persist immediately
  return token
}

/**
 * Devolve o ESCOPO do token, ou `null` se ele não vale.
 *
 * Antes devolvia booleano, e era só isso que existia de autorização.
 *
 * Os tokens já persistidos foram gravados como um número puro (`token → expiresAt`).
 * Eles continuam valendo com escopo total: invalidá-los na mudança desconectaria os
 * clientes conectados por um detalhe de formato, o que é castigo sem crime.
 */
function escopoDoToken(token) {
  if (!token) return null

  // Fase 8 — token por consumidor. Mesmo escopo do `MCP_READONLY_TOKEN` abaixo; a diferença
  // é só identidade (`identificarConsumidor`) e revogação (apagar UMA variável de ambiente).
  if (CONSUMIDORES_LEITURA.some((c) => c.token === token)) return ESCOPO_LEITURA

  // Token estático de leitura, para consumidor que não faz o fluxo OAuth. Comparação de
  // igualdade simples porque o valor vem inteiro do ambiente, não de padrão.
  if (MCP_READONLY_TOKEN && token === MCP_READONLY_TOKEN) return ESCOPO_LEITURA

  const registro = accessTokens.get(token)
  if (!registro) return null

  const exp    = typeof registro === 'number' ? registro : registro.exp
  const escopo = typeof registro === 'number' ? ESCOPO_TOTAL : (registro.escopo ?? ESCOPO_TOTAL)

  if (Date.now() > exp) { accessTokens.delete(token); saveTokens(accessTokens); return null }
  return escopo
}

// ── Rayzen API helper ────────────────────────────────────────────────────────

async function apiHeaders() {
  const cfg = await loadConfig()
  return { Authorization: `Bearer ${cfg.apiToken}`, 'Content-Type': 'application/json' }
}

async function api(method, path, body) {
  const cfg = await loadConfig()
  const res = await fetch(`${cfg.apiUrl}${path}`, {
    method,
    headers: await apiHeaders(),
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => String(res.status))
    throw new Error(`Rayzen API ${method} ${path} → ${res.status}: ${text}`)
  }
  return res.json().catch(() => null)
}

async function apiV2(method, path, body) {
  const cfg = await loadConfig()
  const res = await fetch(`${cfg.apiV2Url}${path}`, {
    method,
    headers: await apiHeaders(),
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => String(res.status))
    throw new Error(`Rayzen V2 API ${method} ${path} → ${res.status}: ${text}`)
  }
  return res.json().catch(() => null)
}

async function resolveProjectId(args) {
  const cfg = await loadConfig()
  const pid = args.projectId ?? cfg.projectId
  if (!pid || !String(pid).trim()) {
    throw new Error(
      'projectId não definido. Chame rayzen_list_projects para ver os projetos existentes, rayzen_create_project para criar um novo, ou informe projectId na chamada.',
    )
  }
  return pid
}

// Leitura: cair no MCP_PROJECT_ID (default do ambiente) é conveniência aceitável, mas
// NUNCA silenciosa — o resultado carrega um _warning pra quem chamou saber que os dados
// podem não ser do projeto que imaginava. Este conector (claude.ai / Claude Desktop) não
// tem detecção de repo/git como a sessão local do Claude Code — sem aviso explícito, uma
// leitura no projeto errado é indistinguível de uma leitura correta.
// Ver incidente 2026-08-03: import de blueprint sem projectId explícito caiu no
// MCP_PROJECT_ID default (o próprio projeto Rayzen AI) e ninguém percebeu até tarde.
async function resolveProjectIdLoud(args) {
  const cfg = await loadConfig()
  const id = await resolveProjectId(args)
  return { id, usedDefault: !args.projectId && id === cfg.projectId }
}

// Escrita: nunca cai no MCP_PROJECT_ID. Adivinhar errado numa leitura só mostra dado
// desatualizado; numa escrita, corrompe outro projeto de forma silenciosa e persistente —
// foi exatamente isso que aconteceu no incidente do blueprint "Urna" gravado dentro do
// projeto Rayzen AI. projectId é sempre explícito para qualquer operação que grava dado.
function requireProjectId(args) {
  const pid = args.projectId
  if (!pid || !String(pid).trim()) {
    throw new Error(
      'projectId obrigatório — esta operação grava dado e nunca usa o MCP_PROJECT_ID default. Chame rayzen_list_projects pra achar o projeto certo, ou rayzen_create_project se for uma ideia nova.',
    )
  }
  return pid
}

function withWarning(result, usedDefault, id) {
  if (usedDefault && result && typeof result === 'object') {
    result._warning = `projectId não informado — usando o projeto padrão do ambiente (${id}). Se a intenção era outro projeto, chame rayzen_list_projects.`
  }
  return result
}

// ── Tool definitions (idênticas ao rayzen-mcp.mjs) ──────────────────────────

const TOOLS = [
  {
    name: 'rayzen_list_projects',
    description:
      'Lista os projetos existentes no Rayzen (id, nome, repoSlug, status, description). Use ANTES de importar um blueprint ou registrar algo ' +
      'pra confirmar o projectId certo — nunca adivinhe ou reaproveite um ID de outra tool sem confirmar. ' +
      // Medido em 13/09 contra o Hermes: perguntado "qual o objetivo do projeto X", ele respondeu
      // com o `description` desta tool — texto de CADASTRO, escrito uma vez — em vez do objetivo
      // vigente. E a descrição do próprio Rayzen AI dizia "entre VPS e máquina local", desatualizada
      // desde 09/08. Projeto certo, fonte errada, informação obsoleta servida como estado atual.
      'ATENÇÃO: `description` é texto de cadastro, escrito na criação do projeto e frequentemente ' +
      'desatualizado. NÃO use `description` para responder sobre objetivo, foco, estado ou andamento — ' +
      'isso vem de rayzen_get_state (vigente) ou rayzen_get_resume (o que mudou). Esta tool serve para ' +
      'descobrir o projectId; o que o projeto É agora está em outro lugar.',
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
        projectId: { type: 'string', description: 'ID do projeto (opcional — se omitido, usa o projeto padrão do ambiente e o resultado avisa em _warning; use rayzen_list_projects se não tiver certeza)' },
      },
    },
  },
  {
    name: 'rayzen_get_resume',
    description: 'Brief de retomada: o que mudou desde a última sessão, blockers ativos, próximo passo recomendado.',
    inputSchema: { type: 'object', properties: { projectId: { type: 'string', description: 'ID do projeto (opcional — se omitido, usa o projeto padrão do ambiente e o resultado avisa em _warning)' } } },
  },
  {
    name: 'rayzen_get_events',
    description: 'Últimos eventos da timeline do projeto (ações, decisões, problemas, ideias).',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'ID do projeto (opcional — se omitido, usa o projeto padrão do ambiente e o resultado avisa em _warning)' },
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
        projectId: { type: 'string', description: 'ID do projeto (opcional — se omitido, usa o projeto padrão do ambiente e o resultado avisa em _warning)' },
        limit: { type: 'number', description: 'Número de resultados (padrão: 5)' },
      },
    },
  },
  {
    name: 'rayzen_get_goal',
    description: 'Meta ativa do projeto com critérios de sucesso, KPIs, gap analysis e Next Best Action.',
    inputSchema: { type: 'object', properties: { projectId: { type: 'string', description: 'ID do projeto (opcional — se omitido, usa o projeto padrão do ambiente e o resultado avisa em _warning)' } } },
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
        content: { type: 'string' },
        intent: { type: 'string', enum: ['decision', 'idea', 'problem', 'reference'] },
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
        sessionId: { type: 'string' },
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
    description: 'Analisa um Blueprint em Markdown ou JSON e retorna o que seria criado sem salvar nada.',
    inputSchema: {
      type: 'object',
      required: ['title', 'content', 'format'],
      properties: {
        projectId: { type: 'string', description: 'ID do projeto (opcional — preview não persiste nada, não usa default)' },
        title: { type: 'string' },
        content: { type: 'string' },
        format: { type: 'string', enum: ['markdown', 'json'] },
      },
    },
  },
  {
    name: 'rayzen_blueprint_import',
    description:
      'Importa um Blueprint completo: cria Wiki, indexa no Brain, registra eventos e atualiza planejamento. ' +
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
      'Atalho para importar um planejamento Markdown com todas as opções ativas. ' +
      'Se for uma ideia nova sem projeto ainda, chame rayzen_create_project ANTES — nunca importe sem projectId esperando que o ambiente acerte o projeto certo.',
    inputSchema: {
      type: 'object',
      required: ['title', 'markdown', 'projectId'],
      properties: {
        projectId: { type: 'string', description: 'ID do projeto — obrigatório, nunca usa default (esta tool grava dado)' },
        title: { type: 'string' },
        markdown: { type: 'string' },
        source: { type: 'string', enum: ['chatgpt', 'claude', 'manual', 'github', 'notion'] },
        overwriteWiki: { type: 'boolean' },
      },
    },
  },
  {
    name: 'rayzen_capture_learning',
    description:
      'Grava um aprendizado estruturado DEPOIS de resolver um problema (runbook de deploy, troubleshooting, gotcha, decisão, padrão). ' +
      'Indexa no Brain com escopo de projeto — assim RESSURGE sozinho em rayzen_get_context e rayzen_search_memory na próxima vez que o problema aparecer. ' +
      'Fecha o loop: você executa, o Rayzen lembra.',
    inputSchema: {
      type: 'object',
      required: ['title', 'problem', 'solution', 'projectId'],
      properties: {
        title: { type: 'string', description: 'Título curto e buscável (ex: "Deploy Rayzen no servidor")' },
        problem: { type: 'string', description: 'O que quebrou / o sintoma observado' },
        solution: { type: 'string', description: 'Como foi resolvido — passos concretos e reproduzíveis' },
        type: { type: 'string', enum: ['runbook', 'troubleshooting', 'decision', 'pattern', 'gotcha'], description: 'Tipo (padrão: troubleshooting)' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Tags para recuperação, ex: ["deploy","docker"]' },
        projectId: { type: 'string', description: 'ID do projeto — obrigatório, nunca usa default (esta tool grava dado no Brain)' },
      },
    },
  },
  {
    name: 'rayzen_get_context',
    description:
      'Monta um pacote cirúrgico de contexto para a tarefa atual: ProjectState, meta ativa, planejamento, blockers e memória semântica relevante. Use no início de tarefas de implementação, debugging ou revisão para receber só o contexto que importa. ' +
      // O token de leitura permite esta tool, e ela de fato não grava FATO nenhum — mas "readonly
      // na lista de ferramentas" não é o mesmo que "consulta sem efeitos internos". A cadeia é
      // POST /v2/context/build → ContextEngine → MemoryService.search → trackAccess, que
      // incrementa `accessCount` e promove `inbox → working` a partir de 3 acessos.
      // Consequência: consultar muda o RANKING das próximas consultas. E a promoção mede uso,
      // não verdade — um agente perguntando em loop reordena a memória do projeto.
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
    name: 'rayzen_blueprint_create_feature_plan',
    description: 'Gera um Blueprint Markdown estruturado para uma feature usando o contexto do ProjectState.',
    inputSchema: {
      type: 'object',
      required: ['feature'],
      properties: {
        feature: { type: 'string' },
        projectId: { type: 'string', description: 'ID do projeto (opcional — sem ele o plano é gerado sem contexto de projeto, nunca usa default do ambiente). Se for importar com autoImport, projectId é obrigatório.' },
        context: { type: 'string' },
        mode: { type: 'string', enum: ['architecture', 'implementation', 'debugging', 'review', 'study'] },
        autoImport: { type: 'boolean' },
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
      'Aguarda resultado por até 20s.',
    inputSchema: {
      type: 'object',
      required: ['action'],
      properties: {
        action: { type: 'string', description: 'Ex: jarvis:screenshot, jarvis:browse_and_screenshot, jarvis:run_command' },
        payload: { type: 'object' },
        targetRole: { type: 'string', enum: ['desktop', 'server'] },
        waitResult: { type: 'boolean' },
      },
    },
  },
]

// ── Escopo ───────────────────────────────────────────────────────────────────

/**
 * As ferramentas que um token `leitura` pode chamar.
 *
 * Até 2026-09-06 não existia escopo nenhum: as 21 ferramentas dividiam a mesma
 * superfície e o mesmo token, então qualquer consumidor novo — um agente conversacional,
 * por exemplo — recebia junto as 11 de escrita. O filtro `include`/`exclude` do lado do
 * cliente ajuda contra o modelo chamar o que não deve, mas não é fronteira: quem tem o
 * token alcança tudo por fora.
 *
 * **A lista é de PERMISSÃO, e o padrão é negar.** Ferramenta nova nasce fora daqui, ou
 * seja, indisponível para leitura — alguém precisa decidir conscientemente incluí-la. O
 * inverso (lista de negação) faria toda ferramenta futura entrar no escopo de leitura por
 * omissão, que é exatamente como escopo vaza.
 */
const FERRAMENTAS_DE_LEITURA = new Set([
  'rayzen_get_context',
  'rayzen_search_memory',
  'rayzen_get_state',
  'rayzen_get_events',
  'rayzen_get_wiki',
  'rayzen_get_goal',
  'rayzen_get_resume',
  'rayzen_list_projects',
  'rayzen_list_specialists',
])

// ── MCP Server ───────────────────────────────────────────────────────────────

function createMcpServer(escopo = ESCOPO_TOTAL) {
  const srv = new Server(
    { name: 'rayzen', version: '1.0.0' },
    { capabilities: { tools: {} } },
  )

  // Filtrar na LISTAGEM é o que faz o cliente nem saber que existe escrita — ele não
  // tenta, não erra, não pergunta. É a metade cooperativa da fronteira.
  srv.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: ehSomenteLeitura(escopo) ? TOOLS.filter((t) => FERRAMENTAS_DE_LEITURA.has(t.name)) : TOOLS,
  }))

  srv.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args = {} } = req.params

    // E recusar na CHAMADA é a outra metade, a que vale contra quem não coopera: cliente
    // que guardou a lista antiga, que ignora a listagem, ou que chama direto por HTTP.
    // Só o filtro da listagem seria acordo de cavalheiros, não fronteira.
    if (ehSomenteLeitura(escopo) && !FERRAMENTAS_DE_LEITURA.has(name)) {
      return {
        content: [{ type: 'text', text: `Ferramenta "${name}" indisponível: este token é somente-leitura.` }],
        isError: true,
      }
    }

    try {
      let result

      switch (name) {
        case 'rayzen_list_projects': {
          result = await api('GET', '/projects' + (args.repoSlug ? `?repoSlug=${encodeURIComponent(args.repoSlug)}` : ''))
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

        case 'rayzen_get_wiki':
          result = await api('GET', `/wiki/${encodeURIComponent(args.slug)}`)
          break

        case 'rayzen_add_event':
          result = await api('POST', '/events/cli', {
            content: args.content,
            intent: args.intent,
            projectId: requireProjectId(args),
            source: 'claude-desktop-mcp',
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

        case 'rayzen_list_specialists': {
          const { id, usedDefault } = await resolveProjectIdLoud(args)
          result = withWarning(await apiV2('GET', `/v2/specialist-agents?projectId=${id}`), usedDefault, id)
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

          let polled = null
          for (let i = 0; i < 10; i++) {
            await new Promise((r) => setTimeout(r, 2000))
            const current = await api('GET', `/tasks/${task.id}`).catch(() => null)
            if (current?.status === 'done' || current?.status === 'failed') {
              polled = current
              break
            }
          }
          result = polled ?? { taskId: task.id, status: 'timeout', note: 'Agent não respondeu em 20s' }
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

/**
 * Devolve o escopo do requisitante, ou `null` (já tendo respondido 401).
 *
 * Antes devolvia booleano. Quem chama precisa do escopo para montar o servidor MCP com o
 * conjunto certo de ferramentas — sem isso a autorização pararia na porta e o interior
 * seria irrestrito, que é o que acontecia.
 */
function checkAuth(req, res) {
  const auth = req.headers['authorization'] ?? ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null
  const escopo = escopoDoToken(token)
  if (!escopo) {
    res.writeHead(401, {
      'Content-Type': 'application/json',
      'WWW-Authenticate': `Bearer realm="${MCP_BASE_URL}/mcp"`,
    })
    res.end(JSON.stringify({ error: 'unauthorized' }))
    return null
  }
  // Fase 8 — identidade no log de acesso. Só para consumidor de token estático (por nome ou
  // compartilhado); token OAuth não loga aqui de propósito — o volume de toda chamada
  // autenticada por sessão OAuth normal poluiria o log sem acrescentar identidade nova.
  const consumidor = identificarConsumidor(token)
  if (consumidor) console.log(`[MCP] acesso de "${consumidor}" (escopo: ${escopo})`)
  return escopo
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

  // ── GitHub webhook → build automático ───────────────────────────────────────
  if (req.method === 'POST' && url.pathname === '/webhook/github-build') {
    const rawBody = await readBody(req)
    const signature = req.headers['x-hub-signature-256']
    if (!verifyGithubSignature(rawBody, signature)) {
      res.writeHead(401, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: false, error: 'invalid signature' }))
      return
    }

    const event = req.headers['x-github-event']
    let payload = {}
    try { payload = JSON.parse(rawBody.toString('utf-8')) } catch { /* corpo vazio em ping */ }

    if (event !== 'push' || payload.ref !== 'refs/heads/main') {
      res.writeHead(204)
      res.end()
      return
    }

    res.writeHead(202, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true, accepted: true }))
    triggerRemoteBuild()
    return
  }

  const escopo = checkAuth(req, res)
  if (!escopo) return

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
      const mcpServer = createMcpServer(escopo)
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

httpServer.listen(MCP_PORT, async () => {
  const cfg = await loadConfig()
  console.log(`[rayzen-mcp-http] listening on port ${MCP_PORT}`)
  console.log(`[rayzen-mcp-http] API_URL: ${cfg.apiUrl}`)
  console.log(`[rayzen-mcp-http] auth: OAuth 2.0 (client_id=${OAUTH_CLIENT_ID})`)
  console.log(`[rayzen-mcp-http] default projectId: ${cfg.projectId || '(none — must pass in each call)'}`)
})

// Defesa em profundidade: nenhum erro inesperado deve derrubar o servidor MCP.
// Antes, um JSON malformado ou falha de transport reiniciava o processo (indisponibilidade).
process.on('uncaughtException', (err) => {
  console.error('[rayzen-mcp-http] uncaughtException (ignorado):', err?.message ?? err)
})
process.on('unhandledRejection', (reason) => {
  console.error('[rayzen-mcp-http] unhandledRejection (ignorado):', reason?.message ?? reason)
})
