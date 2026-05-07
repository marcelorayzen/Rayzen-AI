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
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, dirname, extname } from 'node:path'
import { execSync } from 'node:child_process'

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
    apiToken:  process.env.RAYZEN_API_TOKEN  ?? cfg.apiToken  ?? '',
    projectId: process.env.RAYZEN_PROJECT_ID ?? cfg.projectId ?? '',
  }
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

    // Arquivos modificados (staged + unstaged, sem deletados) — top 10
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

async function main() {
  const [raw, cfg] = await Promise.all([readStdin(), loadConfig()])
  if (!raw.trim()) return

  let payload
  try {
    payload = JSON.parse(raw)
  } catch {
    process.exit(0)
  }

  if (cfg.projectId) payload.projectId = cfg.projectId

  // Enriquecer com contexto git (não bloqueia se falhar)
  const git = getGitContext()
  if (git) payload.git = git

  // Anexar conteúdo do arquivo para indexação semântica (Edit/Write)
  const tool = payload.tool_name
  if (tool === 'Edit' || tool === 'Write') {
    const filePath = payload.tool_input?.file_path ?? payload.tool_input?.path
    const content = readFileContent(filePath)
    if (content) payload.fileContent = content
  }

  await post(`${cfg.apiUrl}/events/cli`, payload, cfg.apiToken)
  process.exit(0)
}

main().catch(() => process.exit(0))
