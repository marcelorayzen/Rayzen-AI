#!/usr/bin/env node
/**
 * qa-ingest — roda os testes da api e envia o resultado para o Rayzen
 *
 * Fluxo:
 *   1. pnpm --filter api test -- --json --outputFile <tmp>
 *   2. Converte o JSON do Jest para o formato Allure (array) que o /qa/reports/ingest entende
 *   3. POST /qa/reports/ingest com o conteúdo + metadados do git
 *
 * Uso:
 *   pnpm qa:ingest                # roda tudo
 *   RAYZEN_PROJECT_ID=xxx pnpm qa:ingest
 */

import { spawnSync, execSync } from 'node:child_process'
import { readFileSync, existsSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)))
const configPath = join(rootDir, 'apps', 'agent', 'src', 'hooks', 'hook.config.mjs')
const RESULTS_FILE = join(tmpdir(), `rayzen-jest-${Date.now()}.json`)

// ── Config ────────────────────────────────────────────────────────────────────

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

// ── Git ───────────────────────────────────────────────────────────────────────

function gitInfo() {
  const run = (cmd) => { try { return execSync(cmd, { encoding: 'utf8', timeout: 3000, stdio: ['pipe','pipe','ignore'] }).trim() } catch { return '' } }
  return {
    branch:     run('git rev-parse --abbrev-ref HEAD'),
    commitHash: run('git rev-parse --short HEAD'),
  }
}

// ── Jest JSON → Allure JSON ───────────────────────────────────────────────────

function jestToAllure(jestJson) {
  const results = []
  for (const file of (jestJson.testResults ?? [])) {
    const suiteName = file.testFilePath
      ?.replace(/\\/g, '/')
      .split('/')
      .pop()
      ?.replace(/\.spec\.ts$/, '') ?? 'unknown'

    for (const t of (file.testResults ?? [])) {
      const ancestors = t.ancestorTitles?.join(' > ') || suiteName
      let status = 'passed'
      if (t.status === 'failed')  status = 'failed'
      if (t.status === 'pending' || t.status === 'todo' || t.status === 'skipped') status = 'skipped'

      const entry = {
        name:     t.fullName ?? t.title ?? '(unnamed)',
        status,
        duration: t.duration ?? 0,
        labels:   [{ name: 'suite', value: ancestors }],
      }
      if (status === 'failed' && t.failureMessages?.length) {
        entry.statusDetails = { message: t.failureMessages[0].slice(0, 800) }
      }
      results.push(entry)
    }
  }
  return results
}

// ── HTTP ──────────────────────────────────────────────────────────────────────

function httpPost(url, body, token) {
  return new Promise((resolve, reject) => {
    const parsed  = new URL(url)
    const lib     = parsed.protocol === 'https:' ? httpsRequest : httpRequest
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
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode}: ${b.slice(0, 200)}`))
        } else {
          try { resolve(JSON.parse(b)) } catch { resolve(b) }
        }
      })
    })
    req.on('error', reject)
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('timeout')) })
    req.write(payload)
    req.end()
  })
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('→ Rayzen QA Ingest')

  const cfg = await loadConfig()
  if (!cfg.apiToken) {
    console.error('✗ RAYZEN_API_TOKEN não configurado (hook.config.mjs ou variável de ambiente)')
    process.exit(1)
  }
  if (!cfg.projectId) {
    console.error('✗ RAYZEN_PROJECT_ID não configurado')
    process.exit(1)
  }

  // 1. Rodar testes
  console.log('→ Rodando pnpm --filter api test ...')
  const result = spawnSync(
    'pnpm',
    ['--filter', 'api', 'test', '--', '--json', `--outputFile=${RESULTS_FILE}`, '--forceExit'],
    { cwd: rootDir, encoding: 'utf8', shell: true, stdio: 'inherit' }
  )

  if (!existsSync(RESULTS_FILE)) {
    console.error('✗ Arquivo de resultados não gerado — Jest falhou ou outputFile não foi criado')
    process.exit(result.status ?? 1)
  }

  // 2. Ler e converter
  let jestJson
  try {
    jestJson = JSON.parse(readFileSync(RESULTS_FILE, 'utf8'))
    unlinkSync(RESULTS_FILE)
  } catch (e) {
    console.error('✗ Falha ao ler resultados:', e.message)
    process.exit(1)
  }

  const total  = jestJson.numTotalTests  ?? 0
  const passed = jestJson.numPassedTests ?? 0
  const failed = jestJson.numFailedTests ?? 0
  console.log(`→ ${total} testes — ${passed} passou, ${failed} falhou`)

  const allureResults = jestToAllure(jestJson)
  const { branch, commitHash } = gitInfo()

  // 3. Enviar para Rayzen
  console.log(`→ Enviando para ${cfg.apiUrl}/qa/reports/ingest ...`)
  try {
    const res = await httpPost(
      `${cfg.apiUrl}/qa/reports/ingest`,
      {
        projectId:     cfg.projectId,
        tool:          'jest',
        branch:        branch || undefined,
        commitHash:    commitHash || undefined,
        reportContent: JSON.stringify(allureResults),
      },
      cfg.apiToken,
    )
    const runId = res?.id ?? res?.parsed?.id ?? '?'
    const rate  = Math.round(((res?.parsed?.passed ?? passed) / Math.max(res?.parsed?.totalTests ?? total, 1)) * 100)
    console.log(`✓ Run salvo: ${runId} — pass rate ${rate}%`)
  } catch (e) {
    console.error('✗ Falha ao enviar:', e.message)
    process.exit(1)
  }
}

main().catch(e => { console.error('✗', e.message); process.exit(1) })
