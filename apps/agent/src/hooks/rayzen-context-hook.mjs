#!/usr/bin/env node
/**
 * Rayzen AI — UserPromptSubmit hook
 *
 * Injeta automaticamente o estado do projeto Rayzen como contexto em cada
 * prompt do Claude Code. Isso elimina a necessidade de chamar rayzen_get_resume()
 * manualmente no início de cada sessão.
 *
 * Configurar em .claude/settings.json:
 *   "UserPromptSubmit": [{ "matcher": "", "hooks": [{ "type": "command", "command": "node .../rayzen-context-hook.mjs" }] }]
 *
 * Contrato de saída:
 *   - stdout: JSON com hookSpecificOutput.additionalContext  (ou nada se falhar)
 *   - deve terminar em < 2.5s para não atrasar o prompt
 */

import { request } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'
import { execSync } from 'node:child_process'
import { tmpdir } from 'node:os'

const __dir = dirname(fileURLToPath(import.meta.url))
const CONFIG_PATH = join(__dir, 'hook.config.mjs')

// Cache de contexto: reinjecta apenas se o estado mudou ou após 5 min
const CTX_CACHE_TTL = 5 * 60 * 1000
const CTX_CACHE_FILE = join(tmpdir(), 'rayzen-ctx-cache.json')

async function loadConfig() {
  let cfg = {}
  if (existsSync(CONFIG_PATH)) {
    try {
      const url = new URL(`file:///${CONFIG_PATH.replace(/\\/g, '/')}`)
      const mod = await import(url.href)
      cfg = mod.default ?? {}
    } catch { /* ignora */ }
  }
  return {
    apiUrl:    process.env.RAYZEN_API_URL    ?? cfg.apiUrl    ?? 'http://localhost:3001',
    apiToken:  process.env.RAYZEN_API_TOKEN  ?? cfg.apiToken  ?? '',
    projectId: process.env.RAYZEN_PROJECT_ID ?? cfg.projectId ?? '',
  }
}

function getProjectName() {
  try {
    const remote = execSync('git remote get-url origin', { encoding: 'utf8', timeout: 1500, stdio: ['pipe','pipe','ignore'] }).trim()
    const m = remote.match(/\/([^/]+?)(?:\.git)?$/)
    if (m?.[1]) return m[1]
  } catch { /* sem remote */ }
  try {
    const root = execSync('git rev-parse --show-toplevel', { encoding: 'utf8', timeout: 1500, stdio: ['pipe','pipe','ignore'] }).trim()
    return root.split(/[\\/]/).pop() ?? null
  } catch { return null }
}

function httpGet(url, token) {
  return new Promise((resolve) => {
    const parsed = new URL(url)
    const lib    = parsed.protocol === 'https:' ? httpsRequest : request
    const req    = lib({
      hostname: parsed.hostname,
      port:     parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path:     parsed.pathname + parsed.search,
      method:   'GET',
      headers:  { Authorization: `Bearer ${token}` },
    }, (res) => {
      let body = ''
      res.on('data', d => { body += d })
      res.on('end', () => { try { resolve(JSON.parse(body)) } catch { resolve(null) } })
    })
    req.on('error', () => resolve(null))
    req.setTimeout(2000, () => { req.destroy(); resolve(null) })
    req.end()
  })
}

function readCache() {
  try {
    const c = JSON.parse(readFileSync(CTX_CACHE_FILE, 'utf8'))
    if (Date.now() - c.ts < CTX_CACHE_TTL) return c
  } catch { /* ignora */ }
  return null
}

function writeCache(context, updatedAt) {
  try { writeFileSync(CTX_CACHE_FILE, JSON.stringify({ context, updatedAt, ts: Date.now() }), 'utf8') } catch { /* ignora */ }
}

function buildContext(state) {
  if (!state) return null
  const lines = ['### Rayzen — estado atual do projeto']
  if (state.objective)   lines.push(`**Objetivo:** ${state.objective}`)
  if (state.stage)       lines.push(`**Stage:** ${state.stage}`)
  if (state.activeFocus) lines.push(`**Foco:** ${state.activeFocus}`)

  const blockers = state.blockers ?? []
  if (blockers.length)   lines.push(`**Blockers:** ${blockers.join(' · ')}`)

  const steps = (state.nextSteps ?? []).slice(0, 3)
  if (steps.length) {
    lines.push('**Próximos passos:**')
    steps.forEach(s => lines.push(`  - ${typeof s === 'string' ? s : s.title ?? JSON.stringify(s)}`))
  }

  const milestones = (state.milestones ?? []).filter(m => m.status !== 'done').slice(0, 3)
  if (milestones.length) {
    lines.push('**Milestones ativos:**')
    milestones.forEach(m => lines.push(`  - [${m.status}] ${m.title}`))
  }

  lines.push('_(contexto injetado automaticamente pelo hook — chame rayzen_get_context para detalhes cirúrgicos)_')
  return lines.join('\n')
}

async function main() {
  // Não bloquear a leitura de stdin (UserPromptSubmit envia o prompt, mas não precisamos ler)
  process.stdin.resume()
  process.stdin.on('data', () => {})

  const repoName = getProjectName()
  // Só injeta se parecer ser o projeto rayzen-ai
  if (!repoName?.toLowerCase().includes('rayzen')) {
    process.exit(0)
  }

  const cfg = await loadConfig()
  if (!cfg.apiToken || !cfg.projectId) process.exit(0)

  // Cache fresco → reinjecta sem bater na API
  const cached = readCache()
  if (cached?.context) {
    console.log(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        additionalContext: cached.context,
      },
    }))
    process.exit(0)
  }

  const state = await httpGet(`${cfg.apiUrl}/projects/${cfg.projectId}/state`, cfg.apiToken)
  if (!state) process.exit(0)

  const context = buildContext(state)
  if (!context) process.exit(0)

  writeCache(context, state.updatedAt)

  console.log(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext: context,
    },
  }))
  process.exit(0)
}

main().catch(() => process.exit(0))
