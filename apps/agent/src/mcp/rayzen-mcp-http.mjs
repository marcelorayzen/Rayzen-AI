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
 *   WEBHOOK_DEPLOY_HOST   — host SSH para build remoto (default: rayzen@192.0.2.10)
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
import { randomUUID, createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { execFile } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import sessionBinding from './session-binding.js'
import panorama from './panorama.js'
const { montarPanorama } = panorama
import { recusaPorFaltaDeProjeto } from './projeto-padrao.mjs'
import { montarPromptDaSessao } from './proposta-de-sessao.mjs'
import { decidirDeploy } from './webhook-deploy.mjs'
import { extrairEventoDeRotina } from './webhook-rotinas.mjs'

const { principalForToken, bindSession, getAuthorizedSession } = sessionBinding

const MCP_PORT            = Number(process.env.MCP_PORT     ?? 3102)
const OAUTH_CLIENT_ID     = process.env.OAUTH_CLIENT_ID     ?? 'claude-ai'
const OAUTH_CLIENT_SECRET = process.env.OAUTH_CLIENT_SECRET ?? ''
const MCP_BASE_URL        = (process.env.MCP_BASE_URL       ?? 'https://example.com').replace(/\/$/, '')
const GITHUB_WEBHOOK_SECRET = process.env.GITHUB_WEBHOOK_SECRET ?? ''
const WEBHOOK_DEPLOY_HOST   = process.env.WEBHOOK_DEPLOY_HOST   ?? 'rayzen@192.0.2.10'
const WEBHOOK_DEPLOY_KEY    = process.env.WEBHOOK_DEPLOY_KEY    ?? '/run/secrets/webhook_deploy_key'

// ── GitHub webhook → build automático (push em main) ───────────────────────
// A chave SSH usada aqui é dedicada e restrita via forced-command no
// authorized_keys do host — mesmo que este handler tenha um bug, ela só
// consegue rodar "git pull && docker compose build web api api-v2".
// G6, fatia 6: o segredo das rotinas é outro, para um repositório de rotina nunca alcançar o deploy.
const GITHUB_ROTINAS_WEBHOOK_SECRET = process.env.GITHUB_ROTINAS_WEBHOOK_SECRET ?? ''

function verifyGithubSignature(rawBody, signatureHeader, segredo = GITHUB_WEBHOOK_SECRET) {
  if (!segredo || !signatureHeader?.startsWith('sha256=')) return false
  const expected = createHmac('sha256', segredo).update(rawBody).digest('hex')
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

const ESCOPO_TOTAL    = 'total'
const ESCOPO_LEITURA  = 'leitura'
/**
 * Item 7.6c (decidido 12/11): leitura + PROPOR um projeto novo — e nada além. "Propor" é criar
 * o envelope (`ProjectHandoff`) e submetê-lo; aprovar exige `APPROVAL_TOKEN`, que este servidor
 * não tem, e materializar não está entre as ferramentas. É o caminho para o Hub (internet)
 * fechar "ideia → projeto" sem receber escrita.
 */
const ESCOPO_PROPOSTA = 'proposta'

/**
 * Quais consumidores `MCP_TOKEN_<NOME>` sobem de `leitura` para `proposta`. Opt-in por nome,
 * nunca por padrão: consumidor novo nasce só-leitura, e um nome que não existe aqui não
 * ganha nada.
 */
const CONSUMIDORES_PROPOSTA = new Set(
  (process.env.MCP_CONSUMIDORES_PROPOSTA ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
)

/**
 * Item 8.2 (decidido por Marcelo em 13/11): o Hub como assistente com mãos. `assistente` =
 * `proposta` + mãos DIRETAS — escrita que fica DENTRO do Rayzen e é reversível (decisão, nota,
 * planejamento, aprendizado, ciclo de vida do projeto). Efeito fora do Rayzen continua sendo
 * envelope com aprovação humana; terminal/arquivo genéricos continuam fora (11/11).
 *
 * Escopo próprio, e não `proposta` ampliado: `proposta` promete "o máximo é um envelope", e
 * mudar o que um nome promete sem mudar o nome é como fronteira vaza. Opt-in por nome, como
 * os outros.
 */
const ESCOPO_ASSISTENTE = 'assistente'
const CONSUMIDORES_ASSISTENTE = new Set(
  (process.env.MCP_CONSUMIDORES_ASSISTENTE ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
)

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
 * Para o LOG de acesso e, desde 12/11, para RETIRAR o projeto padrão de quem fala em nome de um
 * fio (`projeto-padrao.mjs`) — nunca decide autorização (`escopoDoToken` já fez isso). Devolve o
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

function ehProposta(escopo) {
  return escopo === ESCOPO_PROPOSTA
}

function ehAssistente(escopo) {
  return escopo === ESCOPO_ASSISTENTE
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
function escopoDoToken(token, peloProxy = false) {
  if (!token) return null

  // Fase 8 — token por consumidor. Mesmo escopo do `MCP_READONLY_TOKEN` abaixo; a diferença
  // é só identidade (`identificarConsumidor`) e revogação (apagar UMA variável de ambiente).
  const consumidor = CONSUMIDORES_LEITURA.find((c) => c.token === token)
  if (consumidor) {
    const escreve = CONSUMIDORES_ASSISTENTE.has(consumidor.nome) || CONSUMIDORES_PROPOSTA.has(consumidor.nome)
    // 13/11 (item 8.2): consumidor que ESCREVE só vale de dentro. `/mcp` é público em
    // example.com; sem isto, o `MCP_TOKEN_HERMES` vazado daria as mãos do Hub a qualquer um
    // na internet. Recusa inteira, não rebaixa para leitura: credencial de dentro apresentada
    // de fora é sinal de vazamento, não pedido legítimo. Consumidor só de leitura externo
    // (ex.: `MCP_TOKEN_RAYZEN_AI`) segue valendo de fora — é o uso declarado dele.
    if (escreve && peloProxy) {
      console.warn(`[MCP] token de consumidor que escreve recusado: chegou pelo proxy, só vale na rede interna`)
      return null
    }
    if (CONSUMIDORES_ASSISTENTE.has(consumidor.nome)) return ESCOPO_ASSISTENTE
    return CONSUMIDORES_PROPOSTA.has(consumidor.nome) ? ESCOPO_PROPOSTA : ESCOPO_LEITURA
  }

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
  // Sem corpo, sem `Content-Type`. O Fastify recusa `application/json` com corpo vazio (400
  // "Body cannot be empty…") ANTES de qualquer lógica — achado pelo próprio Hub em 13/11: as duas
  // propostas viravam rascunho e travavam no `/submit`, a primeira rota sem corpo que ele chamou.
  const headers = await apiHeaders()
  if (!body) delete headers['Content-Type']
  const res = await fetch(`${cfg.apiUrl}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => String(res.status))
    throw new Error(`Rayzen API ${method} ${path} → ${res.status}: ${text}`)
  }
  return res.json().catch(() => null)
}

// ── Senha do OAuth: quem confere é a API, não uma cópia da regra aqui (13/11) ──────────────
//
// O OAuth comparava a senha digitada com a variável de ambiente. Em produção ela é um hash
// argon2 — então a senha VERDADEIRA nunca passava, e só passaria quem digitasse o próprio hash.
// Duas regras para a mesma senha divergiram em silêncio; a API já confere argon2 (e texto puro
// quando permitido) e limita 10 tentativas/min. Uma autoridade, não duas.
//
// O bloqueio local existe porque o limite da API é por IP, e aqui o IP é sempre o do mcp-http:
// sem ele, 10/min seria a única barreira para um login que entrega escopo TOTAL. Falhas
// consecutivas fecham a porta por 15 min — para todos, inclusive a senha certa. Mesma regra da
// aprovação pelo Hub (`aprovacao-pelo-hub.service.ts`).
const OAUTH_MAX_FALHAS = 5
const OAUTH_JANELA_MS = 15 * 60 * 1000
const falhasDeLogin = []

function loginOAuthBloqueado(agora = Date.now()) {
  while (falhasDeLogin.length && agora - falhasDeLogin[0] > OAUTH_JANELA_MS) falhasDeLogin.shift()
  return falhasDeLogin.length >= OAUTH_MAX_FALHAS
}

async function senhaDoAdminConfere(password) {
  if (!password) return false
  try {
    const cfg = await loadConfig()
    const res = await fetch(`${cfg.apiUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    })
    return res.ok
  } catch {
    // API fora do ar: recusa. Login que passa quando o conferente não responde não é login.
    return false
  }
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
    // S1 (15/11): as três perguntas do aceite, respondidas pelo registro — nunca pela redação do modelo.
    name: 'rayzen_get_autonomy',
    description: 'O que o Rayzen fez sozinho (aprovado pela alçada autônoma), o que está propondo (aguardando o Marcelo), '
      + 'o que parou e precisa dele, perguntas de sessão esperando resposta, entregas confirmadas com link do PR, '
      + 'e o que detectou e não pode tocar (invariantes quebrados). Use para responder "o que você fez?" ou '
      + '"o que está pendente?" — responda só com o que vier aqui e cite o link do PR quando houver.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'ID do projeto (obrigatório vindo do Hub — o fio é dono do escopo)' },
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
    // 17/11: medido — uma resposta de código fazia 5–6 idas ao modelo (README, src, package.json,
    // memória, AGENTS.md, ESTADO…), e cada ida custa uma rodada de raciocínio. Isto traz o essencial
    // numa ida só; as leituras correm em paralelo do lado do servidor.
    name: 'rayzen_project_overview',
    description:
      'PANORAMA de um projeto numa chamada só: estado (objetivo, fase, próximos passos), árvore de ' +
      'arquivos, README, package.json, AGENTS.md e docs/ESTADO-DO-PROJETO.md (cada um resumido no ' +
      'começo). Use PRIMEIRO em qualquer pedido sobre o código ou a estrutura de um projeto, em vez de ' +
      'ler arquivo por arquivo; depois leia só o que faltar com rayzen_read_file.',
    inputSchema: {
      type: 'object',
      required: ['projectId'],
      properties: { projectId: { type: 'string', description: 'ID do projeto (o do fio atual)' } },
    },
  },
  {
    name: 'rayzen_list_files',
    description:
      'Lista os arquivos REAIS do repositório do projeto, lidos agora do checkout na máquina de trabalho ' +
      '(respeita .gitignore; marca o que ainda não foi commitado e o que é segredo). Use SEMPRE que a ' +
      'pergunta for sobre arquivos/estrutura do projeto — nunca descreva arquivos de memória. Se o agent ' +
      'estiver offline, diga isso; não complete a lista.',
    inputSchema: {
      type: 'object',
      required: ['projectId'],
      properties: {
        projectId: { type: 'string', description: 'ID do projeto (o do fio atual)' },
        path: { type: 'string', description: 'Subpasta relativa à raiz do repositório (opcional, ex: src)' },
      },
    },
  },
  {
    name: 'rayzen_read_file',
    description:
      'Lê UM arquivo real do repositório do projeto (caminho relativo à raiz). Arquivo inexistente volta ' +
      'como existe:false — diga que ele não existe. Segredo (.env, chaves) é recusado e nunca é lido.',
    inputSchema: {
      type: 'object',
      required: ['projectId', 'path'],
      properties: {
        projectId: { type: 'string', description: 'ID do projeto (o do fio atual)' },
        path: { type: 'string', description: 'Caminho relativo à raiz do repositório (ex: src/app.ts)' },
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
    description:
      'Atualiza o planejamento do projeto: milestones, blockers, próximos passos. Milestones que não ' +
      'vierem continuam como estão. Para RENOMEAR, mande o id que já existe com o título novo. Para ' +
      'REMOVER, mande o título (ou o id) com remove: true.',
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
              remove: { type: 'boolean', description: 'true tira este milestone da lista' },
            },
          },
        },
        blockers: { type: 'array', items: { type: 'string' } },
        nextSteps: { type: 'array', items: { type: 'string' } },
        backlog: {
          type: 'array',
          description: 'Itens a ACRESCENTAR ou atualizar (pelo título); os que não vierem continuam como estão.',
          items: {
            type: 'object',
            required: ['title'],
            properties: {
              title: { type: 'string' },
              status: { type: 'string', enum: ['pending', 'active', 'done'] },
              priority: { type: 'string', enum: ['low', 'medium', 'high'] },
            },
          },
        },
      },
    },
  },
  {
    name: 'rayzen_register_decision',
    description:
      'Registra na linha do tempo do projeto uma decisão que a PESSOA tomou nesta conversa. O texto deve ser ' +
      'a decisão como ela disse (pode resumir, nunca inventar nem completar): é isso que aparece depois como ' +
      '"decisões recentes" do projeto. Não registre o que VOCÊ sugeriu e ela não confirmou.',
    inputSchema: {
      type: 'object',
      required: ['projectId', 'decisao'],
      properties: {
        projectId: { type: 'string', description: 'Projeto da decisão. No Geral, só se a decisão não for de projeto nenhum.' },
        decisao: { type: 'string', description: 'A decisão, nas palavras da pessoa.' },
        porque: { type: 'string', description: 'O motivo que ela deu, se deu.' },
      },
    },
  },
  {
    name: 'rayzen_set_project_status',
    description:
      'Muda o ciclo de vida de um projeto: active (em andamento), paused (parado), done (concluído). Reabrir não ' +
      'perde nada — estado, eventos e memória ficam. Só quando a pessoa pedir.',
    inputSchema: {
      type: 'object',
      required: ['projectId', 'status'],
      properties: {
        projectId: { type: 'string' },
        status: { type: 'string', enum: ['active', 'paused', 'done'] },
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
        idempotencyKey: { type: 'string', description: 'Reutilize a mesma chave ao repetir a mesma intenção.' },
      },
    },
  },
  {
    name: 'rayzen_propose_project',
    description:
      'PROPÕE um projeto novo no padrão Rayzen: monta o envelope (ProjectHandoff) com os arquivos do plano ' +
      'que a PESSOA já aprovou na conversa e o envia para aprovação. NÃO cria nada no disco — a criação só ' +
      'acontece depois que o Marcelo aprova o envelope fora desta conversa. Use só ao final da skill ' +
      'rayzen-project-architect, com o plano revisado. Os arquivos vão para o disco exatamente como enviados ' +
      '(AGENTS.md é obrigatório; nada de .env, .mcp.json ou .claude/ — a integração é escrita pelo gerador).',
    inputSchema: {
      type: 'object',
      required: ['projectId', 'name', 'brief', 'arquivos'],
      properties: {
        projectId: { type: 'string', description: 'projectId do FIO onde a proposta nasceu (no Geral, o id do Geral) — registro de origem, não o projeto novo.' },
        name: { type: 'string', description: 'Nome do projeto novo — vira o nome da pasta em C:/Users/dev/Projects.' },
        brief: { type: 'string', description: 'O problema e a solução em poucas linhas, como a pessoa aprovou.' },
        arquivos: {
          type: 'array',
          description: 'Arquivos do plano, caminho relativo + conteúdo final.',
          items: {
            type: 'object',
            required: ['path', 'conteudo'],
            properties: { path: { type: 'string' }, conteudo: { type: 'string' } },
          },
        },
      },
    },
  },
  {
    name: 'rayzen_propose_session',
    description:
      'PROPÕE uma sessão de trabalho num projeto EXISTENTE: um trabalhador (Claude Code) abre um worktree ' +
      'isolado do repositório, executa a tarefa, roda o que a tarefa pedir e entrega um PR em RASCUNHO com o ' +
      'diff — depois que o Marcelo aprova o envelope e, de novo, o diff final. É assim que você "executa" ' +
      'desenvolvimento: você conduz e julga, o trabalhador escreve. NÃO executa nada por si — só cria o ' +
      'envelope. Use depois de combinar a tarefa com a pessoa na conversa. Objetivo, restrições e critério ' +
      'de pronto são campos separados e obrigatórios: o servidor monta deles a instrução do trabalhador, ' +
      'que além disso lê o AGENTS.md do projeto antes de mudar algo.',
    inputSchema: {
      type: 'object',
      required: ['projectId', 'titulo', 'objetivo', 'restricoes', 'criterioDePronto'],
      properties: {
        projectId: { type: 'string', description: 'projectId do projeto ONDE o trabalho acontece (rayzen_list_projects). Nunca o Geral.' },
        titulo: { type: 'string', description: 'Título curto da tarefa — aparece no cartão de aprovação.' },
        objetivo: { type: 'string', description: 'O que deve existir ao fim, como a pessoa combinou na conversa.' },
        restricoes: { type: 'string', description: 'O que não mexer e os limites (arquivos, áreas, dependências). "Nenhuma além do AGENTS.md" se for o caso.' },
        criterioDePronto: { type: 'string', description: 'Como verificar que terminou: teste, comando ou o que conferir.' },
        prompt: { type: 'string', description: 'Opcional: detalhes adicionais (situação atual, arquivos envolvidos, contexto da descoberta).' },
        aprovacao: {
          type: 'string',
          enum: ['por_entrega', 'por_etapa'],
          description: 'por_entrega (padrão): roda até o fim e para no diff final. por_etapa: para a cada etapa para a pessoa aprovar — use quando a tarefa é arriscada ou exploratória.',
        },
      },
    },
  },
  {
    name: 'rayzen_propose_routine',
    description:
      'PROPÕE uma rotina num projeto EXISTENTE: um gatilho (agenda a cada N minutos, ou um evento do GitHub ' +
      'do repositório do projeto — PR aberto, ou CI que falhou) que, a cada disparo, cria um envelope de ' +
      'sessão de trabalho aguardando aprovação. A rotina NASCE PROPOSTA e não dispara nada até o Marcelo ' +
      'aprová-la no Hub (botão "trabalhos" → Rotinas); mesmo ativa, cada disparo é só um envelope, nunca ' +
      'execução. Objetivo, restrições e critério de pronto seguem a regra de rayzen_propose_session. Nos ' +
      'textos podem entrar marcadores preenchidos no disparo: {{repo}}, {{pr.numero}}, {{pr.ramo}}, {{sha}}, ' +
      '{{workflow}}, {{url}} — só valores estruturais; título e corpo do PR nunca chegam.',
    inputSchema: {
      type: 'object',
      required: ['projectId', 'nome', 'gatilho', 'titulo', 'objetivo', 'restricoes', 'criterioDePronto'],
      properties: {
        projectId: { type: 'string', description: 'projectId do projeto da rotina (rayzen_list_projects). Nunca o Geral.' },
        nome: { type: 'string', description: 'Nome curto da rotina (até 80 caracteres) — aparece na lista de rotinas.' },
        gatilho: { type: 'string', enum: ['agenda', 'github'], description: 'agenda: a cada intervaloMin minutos. github: num evento do repositório do projeto.' },
        intervaloMin: { type: 'integer', description: 'Só para gatilho agenda: minutos entre disparos, de 5 a 10080.' },
        evento: { type: 'string', enum: ['pull_request.opened', 'workflow_run.failure'], description: 'Só para gatilho github: PR aberto, ou workflow concluído com falha.' },
        titulo: { type: 'string', description: 'Título do envelope criado a cada disparo.' },
        objetivo: { type: 'string', description: 'O que deve existir ao fim de cada sessão disparada.' },
        restricoes: { type: 'string', description: 'O que não mexer e os limites.' },
        criterioDePronto: { type: 'string', description: 'Como verificar que terminou.' },
        detalhes: { type: 'string', description: 'Opcional: contexto adicional para o trabalhador.' },
        aprovacao: { type: 'string', enum: ['por_entrega', 'por_etapa'], description: 'Acompanhamento de cada sessão disparada; padrão por_entrega.' },
      },
    },
  },
  {
    name: 'rayzen_propose_memory',
    description:
      'PROPÕE mexer na BIBLIOTECA da memória de um projeto (documentos para busca, citados como dado): ' +
      'guardar um anexo que a pessoa enviou, ou remover um documento. NÃO guarda nem remove nada: cria um ' +
      'cartão que o Marcelo aprova no próprio fio. Use quando a pessoa pedir ("guarda esse PDF na memória", ' +
      '"tira esse documento") ou para SUGERIR guardar um anexo útil — sempre dizendo que é sugestão. Para ' +
      'guardar: o anexoId aparece no cabeçalho do bloco do anexo ("· anexoId ..."). Para remover: o caminho ' +
      'do documento (sourcePath) que aparece nos resultados de busca. Fato, decisão ou regra NÃO vai por ' +
      'aqui — biblioteca é material de consulta, não verdade.',
    inputSchema: {
      type: 'object',
      required: ['projectId', 'acao'],
      properties: {
        projectId: { type: 'string', description: 'projectId do projeto cuja memória muda (rayzen_list_projects).' },
        acao: { type: 'string', enum: ['guardar', 'remover'] },
        anexoId: { type: 'string', description: 'Só para guardar: o id do cabeçalho do bloco do anexo.' },
        sourcePath: { type: 'string', description: 'Só para remover: o caminho do documento na memória.' },
        titulo: { type: 'string', description: 'Opcional: como o cartão chama o documento.' },
      },
    },
  },
  {
    name: 'rayzen_propose_knowledge',
    description:
      'PROPÕE uma entrada no CADERNO de decisões e regras do projeto (conhecimento canônico: o que o Rayzen ' +
      'passa a tratar como verdade). NÃO grava: cria uma proposta que o Marcelo aprova no próprio fio. Use ' +
      'quando a pessoa disser uma decisão, regra, lição ou premissa ("decidi que…", "a regra é…", "lembra ' +
      'que…"). MUDAR uma entrada = propor de novo com a MESMA chave e o conteúdo novo: aprovada, a versão ' +
      'nova substitui a anterior e o histórico fica. RETIRAR = revogar:true com a mesma chave. Documento, PDF ' +
      'ou material de consulta NÃO vai por aqui (isso é rayzen_propose_memory). Escreva o conteúdo como uma ' +
      'afirmação curta e verificável, nas palavras do que a pessoa decidiu — nunca invente o que ela não disse.',
    inputSchema: {
      type: 'object',
      required: ['projectId', 'chave', 'tipo'],
      properties: {
        projectId: { type: 'string', description: 'projectId do projeto (rayzen_list_projects).' },
        chave: { type: 'string', description: 'Identidade estável da entrada, curta e em kebab-case (ex.: hub/modelo-padrao). Mesma chave = mesma entrada.' },
        tipo: { type: 'string', enum: ['decision', 'lesson', 'pattern', 'constraint', 'assumption'], description: 'decisão, lição, padrão, restrição ou premissa.' },
        conteudo: { type: 'string', description: 'A afirmação. Obrigatório, exceto quando revogar=true.' },
        revogar: { type: 'boolean', description: 'true para retirar a entrada desta chave (aprovada, vira uma versão que diz que foi revogada).' },
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
  // S1: só leitura do registro de envelopes e invariantes.
  'rayzen_get_autonomy',
  'rayzen_list_projects',
  'rayzen_list_specialists',
  // Item 3: leitura do checkout do projeto — só GET, segredo recusado no agent.
  'rayzen_list_files',
  'rayzen_read_file',
  // 17/11: panorama do projeto numa ida só (estado + árvore + README + package.json + AGENTS).
  'rayzen_project_overview',
])

/**
 * O que o escopo `proposta` acrescenta à leitura. Mesma disciplina: lista de PERMISSÃO,
 * padrão negar. Entra aqui só ferramenta cujo efeito máximo é um envelope aguardando
 * aprovação humana.
 */
const FERRAMENTAS_DE_PROPOSTA = new Set([
  'rayzen_propose_project',
  // 13/11: as "mãos" do Hub são propostas — o efeito máximo segue sendo um envelope.
  'rayzen_propose_session',
  // G6.4 (21/11): a rotina nasce `proposta`, só pessoa aprova; ativa, cada disparo é um envelope.
  'rayzen_propose_routine',
  // HC4b (22/11): guardar anexo / remover documento da biblioteca — o efeito máximo é um cartão.
  'rayzen_propose_memory',
  // HC4b (22/11): o caderno (gaveta 2) — proposta de conhecimento; só o dono aprova, na V2.
  'rayzen_propose_knowledge',
])

/**
 * Item 8.2 — mãos DIRETAS do escopo `assistente`: escrita dentro do Rayzen, reversível, sem
 * envelope. Mesma disciplina: lista de PERMISSÃO. `rayzen_checkpoint`, `rayzen_agent_task`,
 * blueprint e `create_project` ficam de fora de propósito — os dois primeiros disparam LLM ou
 * execução no PC, e os últimos criam coisa nova (isso é proposta, com envelope).
 */
const FERRAMENTAS_DIRETAS = new Set([
  'rayzen_register_decision',
  'rayzen_add_event',
  'rayzen_update_planning',
  'rayzen_capture_learning',
  'rayzen_set_project_status',
])

/** O que cada escopo restrito pode listar e chamar; `total` não passa por aqui. */
function ferramentasDoEscopo(escopo) {
  if (ehSomenteLeitura(escopo)) return FERRAMENTAS_DE_LEITURA
  if (ehProposta(escopo)) return new Set([...FERRAMENTAS_DE_LEITURA, ...FERRAMENTAS_DE_PROPOSTA])
  if (ehAssistente(escopo)) return new Set([...FERRAMENTAS_DE_LEITURA, ...FERRAMENTAS_DE_PROPOSTA, ...FERRAMENTAS_DIRETAS])
  return null
}

/** O Geral é escopo de conversa, não repositório: sessão ali não tem checkout. */
const PROJETO_GERAL_ID = '00000000-0000-4000-8000-000000000001'

/** Onde a proposta materializa — fixo aqui, nunca vindo do modelo. */
const RAIZ_DE_PROPOSTA = 'C:/Users/dev/Projects'

// ── MCP Server ───────────────────────────────────────────────────────────────

function createMcpServer(escopo = ESCOPO_TOTAL, consumidor = null) {
  const srv = new Server(
    { name: 'rayzen', version: '1.0.0' },
    { capabilities: { tools: {} } },
  )

  // Filtrar na LISTAGEM é o que faz o cliente nem saber que existe escrita — ele não
  // tenta, não erra, não pergunta. É a metade cooperativa da fronteira.
  srv.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: ehSomenteLeitura(escopo) ? TOOLS.filter((t) => FERRAMENTAS_DE_LEITURA.has(t.name))
      : ehProposta(escopo) ? TOOLS.filter((t) => FERRAMENTAS_DE_LEITURA.has(t.name) || FERRAMENTAS_DE_PROPOSTA.has(t.name))
      : ehAssistente(escopo) ? TOOLS.filter((t) => ferramentasDoEscopo(escopo).has(t.name))
      : TOOLS,
  }))

  srv.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args = {} } = req.params

    // Item 7.5: consumidor que fala em nome de um fio (Hermes) não cai no projeto padrão.
    const semProjeto = recusaPorFaltaDeProjeto(consumidor, name, args)
    if (semProjeto) {
      return { content: [{ type: 'text', text: semProjeto }], isError: true }
    }

    // E recusar na CHAMADA é a outra metade, a que vale contra quem não coopera: cliente
    // que guardou a lista antiga, que ignora a listagem, ou que chama direto por HTTP.
    // Só o filtro da listagem seria acordo de cavalheiros, não fronteira.
    if (ehSomenteLeitura(escopo) && !FERRAMENTAS_DE_LEITURA.has(name)) {
      return {
        content: [{ type: 'text', text: `Ferramenta "${name}" indisponível: este token é somente-leitura.` }],
        isError: true,
      }
    }
    if (ehProposta(escopo) && !FERRAMENTAS_DE_LEITURA.has(name) && !FERRAMENTAS_DE_PROPOSTA.has(name)) {
      return {
        content: [{ type: 'text', text: `Ferramenta "${name}" indisponível: este token só lê e propõe projeto.` }],
        isError: true,
      }
    }
    if (ehAssistente(escopo) && !ferramentasDoEscopo(escopo).has(name)) {
      return {
        content: [{ type: 'text', text: `Ferramenta "${name}" indisponível: o assistente lê, propõe e escreve só dentro do Rayzen.` }],
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

        case 'rayzen_get_autonomy': {
          // projectId explícito, como as ferramentas de arquivo: o fio é dono do escopo, e um
          // "o que você fez?" respondido sobre o projeto padrão do ambiente seria resposta errada com cara de certa.
          const id = requireProjectId(args)
          const resumo = await api('GET', `/handoffs/resumo?projectId=${encodeURIComponent(id)}`)
          // Os invariantes podem falhar sem derrubar o resumo — mas a falha é dita, nunca vira "nada detectado".
          let detecteiENaoPossoTocar
          try {
            const rel = await apiV2('GET', `/v2/invariants/latest/${encodeURIComponent(id)}`)
            const resultados = Array.isArray(rel?.resultados) ? rel.resultados : []
            detecteiENaoPossoTocar = {
              medidoEm: rel?.createdAt ?? null,
              quebrados: resultados.filter((r) => r && r.ok === false)
                .map((r) => ({ titulo: r.titulo, gravidade: r.gravidade, detalhe: r.detalhe, correcao: r.correcao ?? null })),
            }
          } catch (e) {
            detecteiENaoPossoTocar = { erro: `não consegui ler os invariantes: ${e.message}` }
          }
          result = { ...resumo, detecteiENaoPossoTocar }
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

        // Item 3 (12/11): leitura do checkout. projectId SEMPRE explícito (nunca o padrão do
        // ambiente): ler o arquivo do projeto errado é exatamente o defeito que o 7.5 fechou.
        case 'rayzen_project_overview': {
          const pid = requireProjectId(args)
          const base = `/projects/${encodeURIComponent(pid)}`
          const ler = (path) => api('GET', `${base}/files/content?path=${encodeURIComponent(path)}`)
          // Cada parte falha sozinha e diz que falhou — nunca vira "o projeto não tem X".
          const parte = (p) => p.then((v) => ({ ok: true, v }), (e) => ({ ok: false, erro: e.message }))
          const [estado, lista, readme, pkg, agents, estadoDoc] = await Promise.all([
            parte(api('GET', `${base}/state`)), parte(api('GET', `${base}/files`)),
            parte(ler('README.md')), parte(ler('package.json')), parte(ler('AGENTS.md')),
            parte(ler('docs/ESTADO-DO-PROJETO.md')),
          ])
          result = montarPanorama({ estado, lista, readme, pkg, agents, estadoDoc })
          break
        }

        case 'rayzen_list_files': {
          const pid = requireProjectId(args)
          const q = args.path ? `?path=${encodeURIComponent(args.path)}` : ''
          result = await api('GET', `/projects/${encodeURIComponent(pid)}/files${q}`)
          break
        }

        case 'rayzen_read_file': {
          const pid = requireProjectId(args)
          result = await api('GET', `/projects/${encodeURIComponent(pid)}/files/content?path=${encodeURIComponent(args.path ?? '')}`)
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
            // ── Renomear e remover (23/11) ──────────────────────────────────────────
            //
            // O Hub renomeou dois milestones do projeto do desafio mandando o MESMO id com título
            // novo. A chave era só o título, então cada um virou uma entrada nova com id repetido, e o
            // grafo, que usa o id como nó, mostrava um só. E não havia como tirar um item da lista.
            //
            // Agora: título que bate com um item existente identifica o item (é por ele que se remove
            // uma duplicata antiga). Senão, um id que já existe identifica o item: renomear. Senão, é
            // item novo. `remove: true` tira o item.
            const current = await api('GET', `/projects/${projectId}/state`)
            const merged = new Map((current.milestones ?? []).map((m) => [chaveMilestone(m), m]))
            const chavePorId = new Map((current.milestones ?? []).filter((m) => m?.id).map((m) => [String(m.id), chaveMilestone(m)]))
            for (const m of args.milestones) {
              const porTitulo = chaveMilestone(m)
              const k = merged.has(porTitulo) ? porTitulo : (m?.id && chavePorId.get(String(m.id))) || porTitulo
              if (m?.remove === true) { merged.delete(k); continue }
              const { remove: _remove, ...dados } = m
              merged.set(k, { ...merged.get(k), ...dados })
            }
            patch.milestones = [...merged.values()]
          }
          if (args.blockers) patch.blockers = args.blockers
          if (args.nextSteps) patch.nextSteps = args.nextSteps
          if (Array.isArray(args.backlog) && args.backlog.length) {
            // Item 8.2 (13/11). Mesma razão do merge de milestones: a API faz REPLACE do backlog,
            // então um item enviado sozinho apagaria os outros. Identidade pelo título (mesma
            // normalização), o id é cunhado pela API. Bloco próprio de propósito: o de milestones
            // é recortado e EXECUTADO pelo anti-drift stdio × HTTP, e precisa ficar idêntico.
            const chaveBacklog = (b) => String(b?.title ?? '').toLowerCase().normalize('NFD')
              .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()
            const atual = (await api('GET', `/projects/${projectId}/state`)).backlog ?? []
            const merged = new Map(atual.map((b) => [chaveBacklog(b), b]))
            for (const b of args.backlog) {
              const k = chaveBacklog(b)
              if (!k) continue
              const { id: _ignorado, ...semId } = b
              merged.set(k, { ...merged.get(k), ...semId })
            }
            patch.backlog = [...merged.values()]
          }
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
            idempotencyKey: args.idempotencyKey ?? `mcp-http:${randomUUID()}`,
          })

          if (!waitResult) {
            result = { taskId: task.id, status: 'dispatched' }
            break
          }

          let polled = null
          for (let i = 0; i < 10; i++) {
            await new Promise((r) => setTimeout(r, 2000))
            const current = await api('GET', `/tasks/${task.id}`).catch(() => null)
            if (['done', 'failed', 'failed_safe', 'compensated', 'effect_unknown'].includes(current?.status)) {
              polled = current
              break
            }
          }
          result = polled ?? { taskId: task.id, status: 'timeout', note: 'Agent não respondeu em 20s' }
          break
        }

        case 'rayzen_propose_project': {
          // Item 7.6c. Monta o envelope e SUBMETE — e para aí. Tudo que define o efeito (ação,
          // template, raiz) é fixado aqui; do modelo só vêm nome, brief e o conteúdo dos
          // arquivos, que entram no hash que a aprovação assina. A validação completa dos
          // arquivos é do agent, na prévia antes do mkdir (`validarArquivosDoPlano`) — aqui
          // só a forma, para o erro voltar à conversa em vez de virar envelope inútil.
          const origem = requireProjectId(args)
          const nome = typeof args.name === 'string' ? args.name.trim() : ''
          const brief = typeof args.brief === 'string' ? args.brief.trim() : ''
          const arquivos = Array.isArray(args.arquivos) ? args.arquivos : []
          const problemas = []
          if (!nome || nome.length > 80) problemas.push('name precisa ter de 1 a 80 caracteres')
          if (!brief) problemas.push('brief é obrigatório')
          if (!arquivos.length) problemas.push('arquivos é obrigatório — é o plano aprovado')
          if (arquivos.some((a) => typeof a?.path !== 'string' || typeof a?.conteudo !== 'string')) {
            problemas.push('cada arquivo precisa de path e conteudo em texto')
          }
          if (!arquivos.some((a) => typeof a?.path === 'string' && a.path.trim().replace(/^\.\//, '') === 'AGENTS.md')) {
            problemas.push('AGENTS.md é obrigatório no padrão Rayzen')
          }
          if (problemas.length) throw new Error(`proposta recusada: ${problemas.join('; ')}`)

          const envelope = await api('POST', '/handoffs', {
            sourceProjectId: origem,
            name: nome,
            brief,
            template: 'padrao-rayzen',
            root: RAIZ_DE_PROPOSTA,
            efeitos: [{
              actionKey: 'jarvis:create_project_folder',
              payload: { name: nome, template: 'padrao-rayzen', arquivos: arquivos.map((a) => ({ path: a.path, conteudo: a.conteudo })) },
            }],
            principal: `mcp:${consumidor ?? 'oauth'}`,
          })
          const submetido = await api('POST', `/handoffs/${envelope.id}/submit`)
          result = {
            handoffId: envelope.id,
            versao: envelope.version,
            contentHash: envelope.contentHash,
            status: submetido?.status ?? 'awaiting_approval',
            arquivos: arquivos.map((a) => a.path),
            // A alçada vem do servidor (S1, 15/11): criar projeto é `propoe` — um toque, sem código.
            alcada: submetido?.alcada,
            proximoPasso: 'Nada foi criado. O envelope aguarda a aprovação do Marcelo: no Hub, botão "trabalhos" → ' +
              (submetido?.alcada === 'critico' ? 'código do autenticador' : 'aprovar (um toque, sem código)') +
              '. Diga isso a ele com o handoffId. Mudou nome, brief ou arquivo depois daqui? ' +
              'É um envelope novo — não afirme que foi criado.',
          }
          break
        }

        case 'rayzen_register_decision': {
          // Item 8.2. `type: 'decision'` é o que alimenta "decisões recentes" (19/09: só o que
          // foi declarado entra ali). O texto vem do modelo, então a procedência vai junto: quem
          // registrou e por qual canal — uma decisão relatada não pode se passar por digitada.
          const projectId = requireProjectId(args)
          const decisao = typeof args.decisao === 'string' ? args.decisao.trim() : ''
          if (decisao.length < 5) throw new Error('decisao precisa dizer o que foi decidido')
          const porque = typeof args.porque === 'string' && args.porque.trim() ? ` — porque: ${args.porque.trim()}` : ''
          result = await api('POST', '/events/cli', {
            content: `${decisao}${porque}`.slice(0, 2000),
            type: 'decision',
            intent: 'decision',
            source: 'manual',
            projectId,
            metadata: { registradoPor: `mcp:${consumidor ?? 'oauth'}`, canal: 'hub' },
          })
          break
        }

        case 'rayzen_set_project_status': {
          // Item 8.2. Ciclo de vida é decisão de pessoa (20/09) — por isso a ferramenta pede que o
          // modelo só a use a pedido. A API valida o valor; aqui só o que ela não sabe: o Geral é
          // escopo, não projeto com ciclo de vida, e pausá-lo tiraria a conversa geral do ar.
          const projectId = requireProjectId(args)
          if (projectId === PROJETO_GERAL_ID) throw new Error('o Geral não tem ciclo de vida — escolha um projeto')
          if (!['active', 'paused', 'done'].includes(args.status)) throw new Error('status é active, paused ou done')
          result = await api('PATCH', `/projects/${projectId}`, { status: args.status })
          break
        }

        case 'rayzen_propose_session': {
          // 13/11. Mesma disciplina da proposta de projeto: cria e SUBMETE, nunca aprova nem
          // materializa. Efeito, raiz e publicação são fixos aqui; do modelo vêm o projeto, o
          // título, o prompt e o modo de aprovação — tudo dentro do hash que a pessoa assina.
          // `publicar: true` não publica sozinho: o agent para no diff final antes do PR
          // (7.2a, "nada é publicado sem a pessoa ver o diff"), nos dois modos.
          const alvo = requireProjectId(args)
          const titulo = typeof args.titulo === 'string' ? args.titulo.trim() : ''
          // G4.2: o prompt é MONTADO aqui de objetivo, restrições e critério de pronto.
          const { prompt, problemas } = montarPromptDaSessao(args)
          const aprovacao = args.aprovacao ?? 'por_entrega'
          if (alvo === PROJETO_GERAL_ID) problemas.push('o Geral não tem repositório — escolha o projeto com rayzen_list_projects')
          if (!titulo || titulo.length > 120) problemas.push('titulo precisa ter de 1 a 120 caracteres')
          if (aprovacao !== 'por_entrega' && aprovacao !== 'por_etapa') problemas.push('aprovacao é por_entrega ou por_etapa')
          if (problemas.length) throw new Error(`proposta recusada: ${problemas.join('; ')}`)

          const envelope = await api('POST', '/handoffs', {
            sourceProjectId: alvo,
            name: titulo,
            brief: prompt,
            template: 'sessao',
            root: RAIZ_DE_PROPOSTA,
            efeitos: [{
              actionKey: 'jarvis:supervised_session',
              payload: { projectId: alvo, prompt, publicar: true, aprovacao },
            }],
            principal: `mcp:${consumidor ?? 'oauth'}`,
          })
          const submetido = await api('POST', `/handoffs/${envelope.id}/submit`)
          result = {
            handoffId: envelope.id,
            versao: envelope.version,
            contentHash: envelope.contentHash,
            status: submetido?.status ?? 'awaiting_approval',
            aprovacao,
            alcada: submetido?.alcada,
            proximoPasso: 'Nada rodou. O envelope aguarda a aprovação do Marcelo no Hub (botão "trabalhos" → ' +
              (submetido?.alcada === 'critico' ? 'código do autenticador' : 'aprovar, um toque') + '). Aprovado, um trabalhador executa num worktree isolado e PARA no diff final; ' +
              'só vira PR em rascunho depois que ele aprovar esse diff. Diga isso com o handoffId — não afirme ' +
              'que o trabalho foi feito nem antecipe o resultado.',
          }
          break
        }

        case 'rayzen_propose_routine': {
          // G6.4. Só CRIA: a api força `status: 'proposta'`, e aprovar e retomar exigem principal
          // humano (o AGENT_TOKEN deste servidor não passa). O gatilho é montado aqui, campo a
          // campo, para o modelo não mandar objeto com chave que a api não espera; a api valida
          // limites e forma de tudo de novo (rotina.const.ts).
          const alvo = requireProjectId(args)
          if (alvo === PROJETO_GERAL_ID) throw new Error('o Geral não tem repositório — escolha o projeto com rayzen_list_projects')
          const gatilho = args.gatilho === 'agenda'
            ? { tipo: 'agenda', intervaloMin: args.intervaloMin }
            : args.gatilho === 'github'
              ? { tipo: 'github', evento: args.evento }
              : null
          if (!gatilho) throw new Error("gatilho é 'agenda' ou 'github'")
          const modelo = {
            titulo: args.titulo, objetivo: args.objetivo, restricoes: args.restricoes,
            criterioDePronto: args.criterioDePronto, aprovacao: args.aprovacao ?? 'por_entrega',
            ...(typeof args.detalhes === 'string' && args.detalhes.trim() ? { detalhes: args.detalhes } : {}),
          }
          const rotina = await api('POST', '/rotinas', { projectId: alvo, nome: args.nome, gatilho, modelo })
          result = {
            rotinaId: rotina.id,
            status: rotina.status,
            proximoPasso: 'Nada dispara ainda. A rotina aguarda a aprovação do Marcelo no Hub (botão "trabalhos" → ' +
              'Rotinas). Aprovada, cada disparo só cria um envelope de sessão que também precisa de aprovação. ' +
              'Diga isso com o rotinaId — não afirme que a rotina está ativa.',
          }
          break
        }

        case 'rayzen_propose_memory': {
          // HC4b. Só CRIA a proposta; guardar e remover acontecem quando uma pessoa aprova no fio
          // (a api recusa aprovar com o AGENT_TOKEN deste servidor). Campos montados um a um.
          const alvo = requireProjectId(args)
          if (args.acao !== 'guardar' && args.acao !== 'remover') throw new Error("acao é 'guardar' ou 'remover'")
          const proposta = await api('POST', '/hub/memoria/propostas', {
            acao: args.acao,
            projectId: alvo,
            ...(typeof args.anexoId === 'string' ? { anexoId: args.anexoId } : {}),
            ...(typeof args.sourcePath === 'string' ? { sourcePath: args.sourcePath } : {}),
            ...(typeof args.titulo === 'string' ? { titulo: args.titulo } : {}),
          })
          result = {
            propostaId: proposta.id,
            status: proposta.status,
            proximoPasso: 'Nada mudou na memória ainda. Um cartão apareceu no fio para o Marcelo aprovar ou ' +
              'rejeitar. Diga isso — não afirme que foi guardado ou removido.',
          }
          break
        }

        case 'rayzen_propose_knowledge': {
          // HC4b, gaveta 2. Cria uma proposta `candidate` na governança da V2; aprovar exige o dono
          // do conhecimento (pessoa), que este servidor não é. Mudar = mesma chave, conteúdo novo
          // (a aprovação substitui a versão ativa). Retirar = uma versão que diz que foi revogada:
          // o caderno não apaga nada, então a história de que a regra existiu e saiu fica.
          const alvo = requireProjectId(args)
          const chave = typeof args.chave === 'string' ? args.chave.trim().toLowerCase() : ''
          if (!/^[a-z0-9][a-z0-9/._-]{1,119}$/.test(chave)) throw new Error('chave curta, em kebab-case (ex.: hub/modelo-padrao)')
          const tipos = ['decision', 'lesson', 'pattern', 'constraint', 'assumption']
          if (!tipos.includes(args.tipo)) throw new Error(`tipo é ${tipos.join(', ')}`)
          const revogar = args.revogar === true
          const conteudo = revogar
            ? `REVOGADO: a entrada "${chave}" foi retirada a pedido do Marcelo e não vale mais.`
            : (typeof args.conteudo === 'string' ? args.conteudo.trim() : '')
          if (!conteudo) throw new Error('conteudo é obrigatório (ou revogar: true)')
          const idempotencyKey = createHash('sha256').update(`${alvo}|${chave}|${conteudo}`).digest('hex').slice(0, 40)
          const proposta = await apiV2('POST', '/v2/memory/knowledge/proposals', {
            scopeType: 'project',
            projectId: alvo,
            logicalKey: chave,
            idempotencyKey,
            content: conteudo,
            knowledgeType: args.tipo,
            sourceType: 'hub-conversa',
            sourceIdentity: `hub/${alvo}/${chave}`,
            producer: `mcp:${consumidor ?? 'oauth'}`,
          })
          result = {
            propostaId: proposta?.id ?? proposta?.proposal?.id,
            proximoPasso: 'Nada entrou no caderno ainda. Um cartão apareceu no fio para o Marcelo aprovar ou ' +
              'rejeitar. Diga isso — não afirme que a regra já vale.',
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

// sessionId → { transport, principal, consumidor, escopo }. O bearer bruto nunca é guardado aqui.
const transports = new Map()

function headerValue(value) {
  return Array.isArray(value) ? value[0] : value
}

/**
 * Devolve principal, consumidor e escopo do requisitante, ou `null` após responder 401.
 *
 * O contexto completo vincula a sessão à credencial que a criou; o escopo também monta o
 * servidor MCP com o conjunto certo de ferramentas.
 */
/**
 * A requisição atravessou o Caddy, ou seja, veio da internet ou da LAN — não da rede interna
 * do Docker. O `reverse_proxy` do Caddy ACRESCENTA estes cabeçalhos em toda requisição; quem
 * está do lado de fora pode mandar os seus, mas não consegue tirar os do proxy. O Hermes fala
 * direto com `mcp-http:3102`, sem passar por ele.
 */
function veioPeloProxy(req) {
  return Boolean(req.headers['x-forwarded-for'] || req.headers['x-forwarded-host'])
}

function checkAuth(req, res) {
  const authorization = headerValue(req.headers['authorization']) ?? ''
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : null
  const escopo = escopoDoToken(token, veioPeloProxy(req))
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
  return { escopo, principal: principalForToken(token), consumidor }
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

    if (loginOAuthBloqueado()) {
      res.writeHead(429, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(LOGIN_HTML(state, redirectUri, clientId, 'Muitas tentativas — aguarde 15 minutos'))
      return
    }
    if (!(await senhaDoAdminConfere(password))) {
      falhasDeLogin.push(Date.now())
      console.warn(`[MCP] login OAuth recusado (${falhasDeLogin.length}/${OAUTH_MAX_FALHAS} na janela)`)
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(LOGIN_HTML(state, redirectUri, clientId, 'Senha incorreta'))
      return
    }
    falhasDeLogin.length = 0

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

    // G6, fatia 1: além de push em main, o push tem de ser DESTE repositório (ver webhook-deploy.mjs).
    const decisao = decidirDeploy(event, payload)
    if (!decisao.deployar) {
      if (event === 'push') console.log(`[webhook] deploy ignorado — ${decisao.motivo}`)
      res.writeHead(204)
      res.end()
      return
    }

    res.writeHead(202, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true, accepted: true }))
    triggerRemoteBuild()
    return
  }

  // ── GitHub webhook → rotinas (G6, fatia 6) ─────────────────────────────────
  // Rota e segredo próprios. Só campos estruturados seguem para a api (webhook-rotinas.mjs), e a
  // api decide se alguma rotina ativa casa com o evento — aqui não se cria envelope nenhum.
  if (req.method === 'POST' && url.pathname === '/webhook/github-rotinas') {
    const rawBody = await readBody(req)
    if (!verifyGithubSignature(rawBody, req.headers['x-hub-signature-256'], GITHUB_ROTINAS_WEBHOOK_SECRET)) {
      res.writeHead(401, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: false, error: 'invalid signature' }))
      return
    }
    let payload = {}
    try { payload = JSON.parse(rawBody.toString('utf-8')) } catch { /* corpo vazio em ping */ }
    const evento = extrairEventoDeRotina(req.headers['x-github-event'], payload)
    if (!evento) {
      res.writeHead(204)
      res.end()
      return
    }
    res.writeHead(202, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true, accepted: true }))
    api('POST', '/rotinas/gatilho/github', evento)
      .then((r) => console.log(`[webhook-rotinas] ${evento.evento} ${evento.repo}: ${JSON.stringify(r).slice(0, 200)}`))
      .catch((err) => console.error(`[webhook-rotinas] api recusou ${evento.evento} ${evento.repo}: ${err.message}`))
    return
  }

  const auth = checkAuth(req, res)
  if (!auth) return

  if (url.pathname !== '/mcp') {
    res.writeHead(404)
    res.end('Not found')
    return
  }

  if (req.method === 'POST') {
    const sessionId = headerValue(req.headers['mcp-session-id'])
    let transport

    if (sessionId) {
      const session = getAuthorizedSession(transports, sessionId, auth)
      if (!session) {
        res.writeHead(404)
        res.end('Session not found')
        return
      }
      transport = session.transport
    }

    if (!transport) {
      // Nova sessão: criar servidor + transport
      const newSessionId = randomUUID()
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => newSessionId,
        onsessioninitialized: (id) => {
          bindSession(transports, id, transport, auth)
        },
      })
      const mcpServer = createMcpServer(auth.escopo, auth.consumidor)
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
    const sessionId = headerValue(req.headers['mcp-session-id'])
    const session = getAuthorizedSession(transports, sessionId, auth)
    if (!session) {
      res.writeHead(404)
      res.end('Session not found')
      return
    }
    await session.transport.handleRequest(req, res)
    return
  }

  if (req.method === 'DELETE') {
    const sessionId = headerValue(req.headers['mcp-session-id'])
    const session = getAuthorizedSession(transports, sessionId, auth)
    if (session) {
      await session.transport.handleRequest(req, res)
      transports.delete(sessionId)
      return
    }
    res.writeHead(404)
    res.end('Session not found')
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
