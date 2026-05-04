#!/usr/bin/env node
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { execSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)))
const configPath = join(rootDir, 'apps', 'agent', 'src', 'hooks', 'hook.config.mjs')

async function loadConfig() {
  let cfg = {}
  if (existsSync(configPath)) {
    try {
      const mod = await import(pathToFileURL(configPath).href)
      cfg = mod.default ?? {}
    } catch {
      cfg = {}
    }
  }

  return {
    apiUrl: process.env.RAYZEN_API_URL ?? cfg.apiUrl ?? 'http://localhost:3001',
    apiToken: process.env.RAYZEN_API_TOKEN ?? cfg.apiToken ?? '',
    projectId: process.env.RAYZEN_PROJECT_ID ?? cfg.projectId ?? '',
  }
}

function run(command) {
  try {
    return execSync(command, {
      cwd: rootDir,
      encoding: 'utf8',
      timeout: 3000,
      stdio: ['pipe', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return ''
  }
}

function gitContext() {
  const branch = run('git rev-parse --abbrev-ref HEAD')
  const lastCommit = run('git log -1 --format=%H|||%s|||%an')
  const [hash, message, author] = lastCommit.split('|||')
  const changedFiles = run('git diff --name-only HEAD')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

  return {
    branch,
    commitHash: hash ? hash.slice(0, 8) : '',
    commitMessage: message ?? '',
    commitAuthor: author ?? '',
    changedFiles,
  }
}

function parseArgs(argv) {
  const args = [...argv]
  const kind = args.shift() ?? 'event'
  const content = args.join(' ').trim()
  return { kind, content }
}

function postJson(url, token, body) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url)
    const payload = JSON.stringify(body)
    const lib = parsed.protocol === 'https:' ? httpsRequest : httpRequest

    const req = lib({
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    }, (res) => {
      let raw = ''
      res.setEncoding('utf8')
      res.on('data', (chunk) => { raw += chunk })
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          resolve(raw)
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${raw}`))
        }
      })
    })

    req.on('error', reject)
    req.write(payload)
    req.end()
  })
}

async function main() {
  const { kind, content } = parseArgs(process.argv.slice(2))
  if (!content) {
    console.error('Uso: pnpm rayzen:event "mensagem" ou pnpm rayzen:checkpoint "resumo"')
    process.exit(1)
  }

  const cfg = await loadConfig()
  if (!cfg.projectId) {
    console.error('RAYZEN_PROJECT_ID ou hook.config.mjs projectId nao configurado.')
    process.exit(1)
  }

  const git = gitContext()
  const isCheckpoint = kind === 'checkpoint'
  const body = {
    projectId: cfg.projectId,
    source: 'manual',
    type: isCheckpoint ? 'note' : 'note',
    intent: isCheckpoint ? 'checkpoint' : 'reference',
    content,
    metadata: {
      source: 'rayzen-event-script',
      kind,
      git,
      changedFiles: git.changedFiles,
    },
  }

  await postJson(`${cfg.apiUrl}/events`, cfg.apiToken, body)
  console.log(`Rayzen ${isCheckpoint ? 'checkpoint' : 'event'} registrado.`)
}

main().catch((err) => {
  console.error(err.message)
  process.exit(1)
})
