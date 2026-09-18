import axios from 'axios'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { basename, extname, join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { homedir } from 'node:os'
import { runGraphify_action } from './actions/run-graphify'
import { triggerGuardianAnalysis } from './guardian-client'
import { beatGuardian } from './system-heartbeat-client'
import { marcarVivo } from './agent-liveness'
import { triggerInvariantsCheck } from './invariants-client'

const INDEXABLE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.md', '.mdx', '.txt', '.json', '.yaml', '.yml',
  '.sql', '.prisma', '.css', '.html', '.py', '.sh', '.bat', '.ps1', '.java',
])
const MAX_FILE_BYTES = 8000

type GitContext = {
  branch?: string
  commitHash?: string
  commitMessage?: string
  commitAuthor?: string
  changedFiles?: string[]
}

type RepoState = {
  signature: string
  lastChangedAt: number
  lastGraphifyAt: number
}

const DEFAULT_INTERVAL_MS = 30_000
const DEFAULT_MAX_DEPTH = 3
const MAX_CHANGED_FILES = 12

const SKIP_DIRS = new Set([
  '.git',
  'node_modules',
  '.next',
  'dist',
  'build',
  'coverage',
  '.cache',
  '.vercel',
])

const states = new Map<string, RepoState>()

type ProjectCacheEntry = { projectId: string | undefined; expiresAt: number }
const projectCache = new Map<string, ProjectCacheEntry>()
const PROJECT_CACHE_HIT_TTL  = 10 * 60 * 1000  // 10 min para resolução positiva
const PROJECT_CACHE_MISS_TTL =  2 * 60 * 1000  // 2 min para resolução negativa — permite retry

const api = axios.create({
  baseURL: process.env.AGENT_API_URL,
  headers: { Authorization: `Bearer ${process.env.AGENT_TOKEN}` },
  timeout: 10_000,
})

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))]
}

function defaultRoots(): string[] {
  const home = homedir()
  return [
    process.cwd(),
    join(home, 'Desktop', 'Projects'),
  ]
}

function workspaceRoots(): string[] {
  const configured = process.env.AGENT_WORKSPACE_ROOTS
    ?.split(/[;,]/)
    .map((item) => item.trim())
    .filter(Boolean)

  return unique(configured?.length ? configured : defaultRoots())
    .map((item) => resolve(item))
    .filter((item) => existsSync(item))
}

function runGit(repoPath: string, args: string[]): string {
  try {
    return execFileSync('git', args, {
      cwd: repoPath,
      encoding: 'utf8',
      timeout: 3000,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      // Só o final. `.trim()` aqui corrompia `git status --porcelain`: a coluna 1 do
      // formato é o status no índice, e um arquivo modificado mas não staged tem
      // ESPAÇO ali (" M LICENSE"). Trimando a saída inteira, a primeira linha perdia
      // esse espaço e o slice(3) de changedFiles() comia a primeira letra do nome —
      // "LICENSE" virava "ICENSE". Isso ia direto pro Guardian: score calculado sobre
      // um caminho inexistente e busca de spec para um arquivo que não existe.
      .replace(/\s+$/, '')
  } catch {
    return ''
  }
}

function findGitRepos(root: string, maxDepth = DEFAULT_MAX_DEPTH): string[] {
  const repos: string[] = []

  function walk(dir: string, depth: number): void {
    if (depth > maxDepth) return
    if (existsSync(join(dir, '.git'))) {
      repos.push(dir)
      return
    }

    let entries: Array<{ name: string; isDirectory(): boolean }>
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }

    for (const entry of entries) {
      if (!entry.isDirectory() || SKIP_DIRS.has(entry.name)) continue
      walk(join(dir, entry.name), depth + 1)
    }
  }

  walk(root, 0)
  return repos
}

function repoSlug(repoPath: string): string {
  const remote = runGit(repoPath, ['remote', 'get-url', 'origin'])
  const match = remote.match(/[/:]([^/:]+?)(?:\.git)?$/)
  return match?.[1] || basename(repoPath)
}

function gitContext(repoPath: string, changedFiles: string[]): GitContext {
  const branch = runGit(repoPath, ['rev-parse', '--abbrev-ref', 'HEAD'])
  const rawCommit = runGit(repoPath, ['log', '-1', '--format=%H|||%s|||%an'])
  const [hash, message, author] = rawCommit.split('|||')

  return {
    branch,
    commitHash: hash ? hash.slice(0, 8) : '',
    commitMessage: message ?? '',
    commitAuthor: author ?? '',
    changedFiles,
  }
}

/**
 * Extrai os caminhos de `git status --porcelain=v1`.
 *
 * Formato: dois caracteres de status (índice, árvore) + espaço + caminho. Os dois
 * primeiros podem ser espaço — " M arquivo" é modificado mas não staged —, então a
 * fatia é sempre de 3 e a entrada NÃO pode ter passado por trim à esquerda.
 *
 * Separado do I/O de propósito: é onde mora a sutileza, e assim dá pra testar sem git.
 */
export function parsePorcelainPaths(raw: string, max = MAX_CHANGED_FILES): string[] {
  if (!raw) return []

  return raw
    .split('\n')
    .filter((line) => line.length > 3)
    .map((line) => line.slice(3).trim())
    // Rename/copy vêm como "antigo -> novo"; o que interessa é o destino.
    .map((line) => line.includes(' -> ') ? line.split(' -> ').at(-1)?.trim() ?? line : line)
    // Caminho com espaço ou caractere especial vem entre aspas.
    .map((line) => line.startsWith('"') && line.endsWith('"') ? line.slice(1, -1) : line)
    .filter(Boolean)
    .slice(0, max)
}

function changedFiles(repoPath: string): string[] {
  return parsePorcelainPaths(runGit(repoPath, ['status', '--porcelain=v1']))
}

function signature(files: string[]): string {
  return files.slice().sort().join('|')
}

async function resolveProjectId(slug: string): Promise<string | undefined> {
  const cached = projectCache.get(slug)
  if (cached && cached.expiresAt > Date.now()) return cached.projectId

  try {
    const { data } = await api.get<Array<{ id: string }>>('/projects', { params: { repoSlug: slug } })
    const projectId = Array.isArray(data) && data.length > 0 ? data[0]?.id : undefined
    projectCache.set(slug, { projectId, expiresAt: Date.now() + (projectId ? PROJECT_CACHE_HIT_TTL : PROJECT_CACHE_MISS_TTL) })
    return projectId
  } catch {
    projectCache.set(slug, { projectId: undefined, expiresAt: Date.now() + PROJECT_CACHE_MISS_TTL })
    return undefined
  }
}

function readFileContent(filePath: string): string | null {
  try {
    if (!INDEXABLE_EXTENSIONS.has(extname(filePath).toLowerCase())) return null
    if (!existsSync(filePath)) return null
    return readFileSync(filePath, 'utf8').slice(0, MAX_FILE_BYTES)
  } catch { return null }
}

async function indexChangedFiles(repoPath: string, files: string[], projectId: string | undefined): Promise<void> {
  if (!projectId) return  // sem escopo de projeto, não indexamos para evitar documentos órfãos

  for (const file of files.slice(0, 8)) {
    const fullPath = join(repoPath, file)
    const content = readFileContent(fullPath)
    if (!content) continue

    try {
      await api.post('/memory/index', {
        content,
        sourcePath: file,
        projectId,
        metadata: { source: 'workspace-watcher', repoPath, file },
      })
    } catch { /* silencioso — não bloqueia o evento */ }
  }
}

async function emitWorkspaceEvent(repoPath: string, files: string[]): Promise<void> {
  const slug = repoSlug(repoPath)
  const projectId = await resolveProjectId(slug)
  const git = gitContext(repoPath, files)
  const suffix = git.branch ? ` [${git.branch}${git.commitHash ? `@${git.commitHash}` : ''}]` : ''
  const fileList = files.slice(0, 5).join(', ')
  const more = files.length > 5 ? ` +${files.length - 5}` : ''

  // Envia evento de atividade
  await api.post('/events', {
    projectId,
    source: 'cli',
    type: 'note',
    intent: 'reference',
    content: `Workspace alterado: ${slug}${suffix} — ${fileList}${more}`,
    metadata: { source: 'workspace-watcher', repoSlug: slug, repoPath, git, changedFiles: files },
  })

  // Indexa conteúdo dos arquivos modificados no Brain (igual ao Claude Code hook)
  await indexChangedFiles(repoPath, files, projectId)

  // Guardian: analisa mudanças em background se projectId estiver disponível
  if (projectId) {
    const v2Url = process.env.AGENT_API_V2_URL ?? (() => {
      try {
        const u = new URL(process.env.AGENT_API_URL ?? '')
        return `${u.protocol}//${u.hostname}:3103`
      } catch { return null }
    })()
    if (v2Url) {
      triggerGuardianAnalysis({
        projectId,
        repoPath,
        changedFiles: files,
        apiV2Url:  v2Url,
        apiToken:  process.env.AGENT_TOKEN ?? '',
      }).catch(() => null)

      // Invariantes pegam carona no watcher, mas com throttle próprio (15min):
      // estado de sistema não muda porque um arquivo foi salvo, e o check de
      // relógio faz chamada HTTP externa. Ver invariants-client.
      triggerInvariantsCheck({
        projectId,
        apiV2Url: v2Url,
        apiToken: process.env.AGENT_TOKEN ?? '',
      }).catch(() => null)
    }
  }
}

async function scanOnce(): Promise<void> {
  const repos = unique(workspaceRoots().flatMap((root) => findGitRepos(root)))

  for (const repoPath of repos) {
    const files = changedFiles(repoPath)
    const sig = signature(files)
    const state = states.get(repoPath)

    if (!state) {
      states.set(repoPath, { signature: sig, lastChangedAt: 0, lastGraphifyAt: 0 })
      continue
    }

    if (sig && sig !== state.signature) {
      state.signature = sig
      state.lastChangedAt = Date.now()

      try {
        await emitWorkspaceEvent(repoPath, files)
        console.log(`[watcher] atividade capturada: ${repoSlug(repoPath)} (${files.length} arquivo(s))`)
      } catch (err) {
        if (process.env.NODE_ENV === 'development') {
          console.error('[watcher] erro ao enviar evento:', (err as Error).message)
        }
      }
    }

    // Dispara graphify após período de inatividade (debounce)
    const graphifyEnabled = process.env.AGENT_GRAPHIFY_ENABLED !== 'false'
    const debounceMs = Number(process.env.AGENT_GRAPHIFY_DEBOUNCE_MS ?? 60_000)
    const idle = state.lastChangedAt > 0 && Date.now() - state.lastChangedAt >= debounceMs
    const notRunYet = state.lastChangedAt > state.lastGraphifyAt

    if (graphifyEnabled && idle && notRunYet) {
      state.lastGraphifyAt = Date.now()
      const slug = repoSlug(repoPath)
      const projectId = await resolveProjectId(slug)
      console.log(`[graphify] iniciando análise incremental: ${slug}`)
      runGraphify_action({ projectPath: repoPath, projectId }).then((result) => {
        console.log(`[graphify] concluído: ${slug}`, (result as { ok?: boolean }).ok ? 'ok' : 'erro')
      }).catch(() => null)
    }
  }
}

export function startWorkspaceWatcher(): void {
  const enabled = process.env.AGENT_WORKSPACE_WATCH_ENABLED !== 'false'
  const role = process.env.AGENT_ROLE === 'server' ? 'server' : 'desktop'
  if (!enabled || role !== 'desktop') return

  const interval = Number(process.env.AGENT_WORKSPACE_WATCH_INTERVAL_MS ?? DEFAULT_INTERVAL_MS)
  console.log(`[watcher] monitorando workspaces: ${workspaceRoots().join('; ')}`)
  console.log(`[watcher] intervalo: ${interval}ms`)

  // O batimento acompanha o TICK, não a análise: `triggerGuardianAnalysis` só
  // dispara quando a assinatura de arquivos muda, então derivar vitalidade dela
  // confundiria "Guardian parado" com "ninguém mexeu em código". O throttle de
  // 5 min mora no próprio cliente.
  // `marcarVivo` ANTES do scan, e fora do then/catch: a pergunta que ele responde é
  // "o processo está rodando", não "o scan deu certo". Um scan que falha todo tick
  // continua sendo um agent de pé — e é o próprio `beatGuardian({ ok:false })` que
  // conta essa outra história. Amarrar os dois faria um watcher com defeito parecer
  // um watcher desligado, que é a ambiguidade que os dois sinais existem para separar.
  const tick = () => {
    marcarVivo()
    return scanOnce()
      .then(() => beatGuardian({ ok: true }))
      .catch((e) => beatGuardian({ ok: false, erro: e instanceof Error ? e.message : String(e) }))
  }

  void tick()
  setInterval(() => { void tick() }, interval)
}
