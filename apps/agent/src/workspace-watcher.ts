import axios from 'axios'
import { existsSync, readdirSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { homedir } from 'node:os'

type GitContext = {
  branch?: string
  commitHash?: string
  commitMessage?: string
  commitAuthor?: string
  changedFiles?: string[]
}

type RepoState = {
  signature: string
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
const projectCache = new Map<string, string | undefined>()

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
    }).trim()
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

function changedFiles(repoPath: string): string[] {
  const raw = runGit(repoPath, ['status', '--porcelain=v1'])
  if (!raw) return []

  return raw
    .split('\n')
    .map((line) => line.slice(3).trim())
    .map((line) => line.includes(' -> ') ? line.split(' -> ').at(-1)?.trim() ?? line : line)
    .filter(Boolean)
    .slice(0, MAX_CHANGED_FILES)
}

function signature(files: string[]): string {
  return files.slice().sort().join('|')
}

async function resolveProjectId(slug: string): Promise<string | undefined> {
  if (projectCache.has(slug)) return projectCache.get(slug)

  try {
    const { data } = await api.get<Array<{ id: string }>>('/projects', { params: { repoSlug: slug } })
    const projectId = Array.isArray(data) && data.length > 0 ? data[0]?.id : undefined
    projectCache.set(slug, projectId)
    return projectId
  } catch {
    projectCache.set(slug, undefined)
    return undefined
  }
}

async function emitWorkspaceEvent(repoPath: string, files: string[]): Promise<void> {
  const slug = repoSlug(repoPath)
  const projectId = await resolveProjectId(slug)
  const git = gitContext(repoPath, files)
  const suffix = git.branch ? ` [${git.branch}${git.commitHash ? `@${git.commitHash}` : ''}]` : ''
  const fileList = files.slice(0, 5).join(', ')
  const more = files.length > 5 ? ` +${files.length - 5}` : ''

  await api.post('/events', {
    projectId,
    source: 'cli',
    type: 'note',
    intent: 'reference',
    content: `Workspace alterado: ${slug}${suffix} — ${fileList}${more}`,
    metadata: {
      source: 'workspace-watcher',
      repoSlug: slug,
      repoPath,
      git,
      changedFiles: files,
    },
  })
}

async function scanOnce(): Promise<void> {
  const repos = unique(workspaceRoots().flatMap((root) => findGitRepos(root)))

  for (const repoPath of repos) {
    const files = changedFiles(repoPath)
    const sig = signature(files)
    const state = states.get(repoPath)

    if (!state) {
      states.set(repoPath, { signature: sig })
      continue
    }

    if (!sig || sig === state.signature) {
      state.signature = sig
      continue
    }

    state.signature = sig

    try {
      await emitWorkspaceEvent(repoPath, files)
      console.log(`[watcher] atividade capturada: ${repoSlug(repoPath)} (${files.length} arquivo(s))`)
    } catch (err) {
      if (process.env.NODE_ENV === 'development') {
        console.error('[watcher] erro ao enviar evento:', (err as Error).message)
      }
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

  scanOnce().catch(() => null)
  setInterval(() => {
    scanOnce().catch(() => null)
  }, interval)
}
