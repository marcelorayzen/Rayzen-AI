#!/usr/bin/env node
/**
 * check-deploy-impact — mostra o que um deploy vai afetar, antes do deploy.
 *
 * Pega o diff de arquivos mudados (branch atual vs. base) e consulta o lineage
 * de código real (sincronizado via `pnpm --filter agent ...` → jarvis:graphify_sync)
 * pra listar módulos e rotas impactados, direta ou transitivamente.
 *
 * É só leitura — não roda graphify, não custa API de LLM. Se o lineage estiver
 * desatualizado (ninguém rodou graphify_sync recentemente), o resultado reflete
 * o último snapshot sincronizado, não o estado atual do código.
 *
 * Uso:
 *   pnpm impact:check                      # diff vs origin/main (ou main), local
 *   IMPACT_BASE_REF=origin/develop pnpm impact:check
 *   (em CI: detecta GITHUB_BASE_REF / GITHUB_EVENT_BEFORE automaticamente)
 */

import { execSync } from 'node:child_process'
import { existsSync, appendFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)))
const configPath = join(rootDir, 'apps', 'agent', 'src', 'hooks', 'hook.config.mjs')

async function loadConfig() {
  let cfg = {}
  if (existsSync(configPath)) {
    try {
      const mod = await import(pathToFileURL(configPath).href)
      cfg = mod.default ?? {}
    } catch { /* ignora */ }
  }
  return {
    apiUrl:    process.env.RAYZEN_API_URL    ?? cfg.apiUrl    ?? 'http://localhost:3001',
    apiToken:  process.env.RAYZEN_API_TOKEN  ?? cfg.apiToken  ?? '',
    projectId: process.env.RAYZEN_PROJECT_ID ?? cfg.projectId ?? '',
  }
}

function run(cmd) {
  try { return execSync(cmd, { encoding: 'utf8', timeout: 10000, stdio: ['pipe', 'pipe', 'pipe'], cwd: rootDir }).trim() }
  catch { return '' }
}

function resolveBaseRef() {
  if (process.env.IMPACT_BASE_REF) return process.env.IMPACT_BASE_REF
  if (process.env.GITHUB_BASE_REF) return `origin/${process.env.GITHUB_BASE_REF}`
  if (process.env.GITHUB_EVENT_BEFORE && !/^0+$/.test(process.env.GITHUB_EVENT_BEFORE)) return process.env.GITHUB_EVENT_BEFORE
  if (run('git rev-parse --verify origin/main')) return 'origin/main'
  return 'main'
}

function changedFiles(baseRef) {
  const diff = run(`git diff --name-only ${baseRef}...HEAD`)
  if (!diff) return []
  return diff
    .split('\n')
    .map(f => f.trim())
    .filter(f => /\.(ts|tsx)$/.test(f) && !f.includes('node_modules') && !f.includes('/generated/') && !f.includes('.d.ts'))
}

function httpPost(url, body, token) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url)
    const lib = parsed.protocol === 'https:' ? httpsRequest : httpRequest
    const payload = JSON.stringify(body)
    const req = lib({
      hostname: parsed.hostname,
      port:     parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path:     parsed.pathname + parsed.search,
      method:   'POST',
      headers: {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(payload),
        Authorization:    `Bearer ${token}`,
      },
    }, (res) => {
      let b = ''
      res.on('data', d => { b += d })
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 400) reject(new Error(`HTTP ${res.statusCode}: ${b.slice(0, 300)}`))
        else { try { resolve(JSON.parse(b)) } catch { resolve(b) } }
      })
    })
    req.on('error', reject)
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('timeout')) })
    req.write(payload)
    req.end()
  })
}

function renderReport(baseRef, files, result) {
  const lines = []
  lines.push(`## Impact analysis (pré-deploy)`)
  lines.push(``)
  lines.push(`Diff: \`${baseRef}...HEAD\` — ${files.length} arquivo(s) TS mudado(s)`)
  lines.push(``)
  if (result.aggregated.length === 0) {
    lines.push('Nenhum impacto transitivo detectado (ou lineage não sincronizado pra esses arquivos).')
    return lines.join('\n')
  }
  if (result.aggregatedRoutes.length > 0) {
    lines.push(`### Rotas impactadas (${result.aggregatedRoutes.length})`)
    for (const r of result.aggregatedRoutes) lines.push(`- \`${r.path}\` (prefix: \`${r.routePrefix || '/'}\`, depth ${r.depth})`)
    lines.push('')
  }
  const otherFiles = result.aggregated.filter(n => !n.isRoute)
  if (otherFiles.length > 0) {
    lines.push(`### Outros módulos impactados (${otherFiles.length})`)
    for (const f of otherFiles.slice(0, 30)) lines.push(`- \`${f.path}\` (depth ${f.depth})`)
    if (otherFiles.length > 30) lines.push(`- ... e mais ${otherFiles.length - 30}`)
  }
  return lines.join('\n')
}

async function main() {
  const cfg = await loadConfig()
  if (!cfg.apiToken || !cfg.projectId) {
    console.error('✗ RAYZEN_API_TOKEN / RAYZEN_PROJECT_ID não configurados — pulando impact analysis')
    process.exit(0) // não bloqueia deploy por falta de config
  }

  const baseRef = resolveBaseRef()
  const files = changedFiles(baseRef)

  if (files.length === 0) {
    console.log(`→ Nenhum arquivo .ts/.tsx mudado entre ${baseRef} e HEAD — nada a analisar.`)
    process.exit(0)
  }

  console.log(`→ Consultando impacto de ${files.length} arquivo(s) mudado(s) (base: ${baseRef})...`)

  try {
    const result = await httpPost(`${cfg.apiUrl}/v2/lineage/files/impact-batch`, {
      projectId: cfg.projectId,
      filePaths: files,
    }, cfg.apiToken)

    const report = renderReport(baseRef, files, result)
    console.log('\n' + report + '\n')

    if (process.env.GITHUB_STEP_SUMMARY) {
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, report + '\n')
    }
  } catch (e) {
    console.error(`✗ Falha ao consultar impact analysis: ${e.message}`)
    // informativo, não bloqueia deploy/CI
  }
}

main().catch(e => { console.error('✗', e.message); process.exit(0) })
