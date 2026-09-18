#!/usr/bin/env node
/**
 * qa-ingest — roda os testes do monorepo e envia UM run consolidado ao Rayzen
 *
 * Antes cobria só o apps/api, e o número no painel QA (225) parecia ser "os testes
 * do projeto" quando era menos da metade das suítes. Agora descobre todo app do
 * workspace que tenha script `test`, roda cada um, soma os resultados e envia um
 * único TestRun — o pass rate passa a valer para o repositório inteiro.
 *
 * A suíte de cada teste é prefixada com o app (ex: "api › blueprint.service") para
 * que uma falha seja atribuível sem abrir o CI.
 *
 * Uso:
 *   pnpm qa:ingest                    # roda tudo e envia
 *   pnpm qa:ingest -- --coverage      # idem, com cobertura (usado no CI)
 *   pnpm qa:ingest -- --dry-run       # roda e mostra o resumo, sem enviar
 *
 * Config (nesta ordem): variável de ambiente → apps/agent/src/hooks/hook.config.mjs
 *   RAYZEN_API_URL · RAYZEN_API_TOKEN · RAYZEN_PROJECT_ID
 *
 * Exit code: 1 se algum teste falhou OU se o envio falhou. O CI depende disso —
 * um número em que não se pode confiar é pior que job vermelho.
 */

import { spawnSync, execSync } from 'node:child_process'
import { readFileSync, existsSync, unlinkSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'

const rootDir    = dirname(dirname(fileURLToPath(import.meta.url)))
const configPath = join(rootDir, 'apps', 'agent', 'src', 'hooks', 'hook.config.mjs')

const args     = process.argv.slice(2)
const coverage = args.includes('--coverage')
const dryRun   = args.includes('--dry-run')

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

// ── Descoberta de apps testáveis ──────────────────────────────────────────────
// Fonte da verdade é o próprio workspace: qualquer app com script `test` entra.
// Assim um app novo passa a contar sem ninguém lembrar de editar esta lista, e um
// app que sai (catalog-guardian, 2026-08-05) some sozinho.

function discoverApps() {
  const appsDir = join(rootDir, 'apps')
  return readdirSync(appsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((name) => {
      const pkgPath = join(appsDir, name, 'package.json')
      if (!existsSync(pkgPath)) return false
      try {
        return Boolean(JSON.parse(readFileSync(pkgPath, 'utf8')).scripts?.test)
      } catch { return false }
    })
    .sort()
}

// ── Git ───────────────────────────────────────────────────────────────────────

function gitInfo() {
  const run = (cmd) => {
    try { return execSync(cmd, { encoding: 'utf8', timeout: 3000, stdio: ['pipe', 'pipe', 'ignore'] }).trim() }
    catch { return '' }
  }
  return {
    branch:     run('git rev-parse --abbrev-ref HEAD'),
    commitHash: run('git rev-parse --short HEAD'),
  }
}

// ── Jest JSON → Allure JSON ───────────────────────────────────────────────────

function jestToAllure(jestJson, appName) {
  const results = []
  for (const file of (jestJson.testResults ?? [])) {
    // Com --outputFile o Jest grava `name` + `assertionResults`; no relatório em
    // memória os mesmos campos aparecem como `testFilePath` + `testResults`. A
    // versão anterior deste script lia só a segunda forma e por isso enviava
    // sempre uma lista vazia — o run era criado sem nenhum caso dentro.
    const filePath = file.name ?? file.testFilePath
    const cases    = file.assertionResults ?? file.testResults ?? []

    const suiteName = filePath
      ?.replace(/\\/g, '/')
      .split('/')
      .pop()
      ?.replace(/\.spec\.ts$/, '') ?? 'unknown'

    for (const t of cases) {
      const ancestors = t.ancestorTitles?.join(' > ') || suiteName
      let status = 'passed'
      if (t.status === 'failed') status = 'failed'
      if (t.status === 'pending' || t.status === 'todo' || t.status === 'skipped') status = 'skipped'

      const entry = {
        name:     `${appName} › ${t.fullName ?? t.title ?? '(unnamed)'}`,
        status,
        duration: t.duration ?? 0,
        labels:   [{ name: 'suite', value: `${appName} › ${ancestors}` }],
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
      res.on('data', (d) => { b += d })
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 400) {
          const err = new Error(`HTTP ${res.statusCode}: ${b.slice(0, 300)}`)
          err.statusCode = res.statusCode
          reject(err)
        } else {
          try { resolve(JSON.parse(b)) } catch { resolve(b) }
        }
      })
    })
    req.on('error', (e) => { e.transient = true; reject(e) })
    req.setTimeout(20000, () => {
      req.destroy()
      const err = new Error('timeout')
      err.transient = true
      reject(err)
    })
    req.write(payload)
    req.end()
  })
}

/**
 * Nem toda falha de envio significa a mesma coisa.
 *
 * 4xx é configuração: token errado, projeto inexistente, payload inválido. Tentar de
 * novo dá o mesmo erro — falhar rápido e dizer o que arrumar é o certo.
 *
 * 5xx, timeout e erro de rede são o servidor piscando. Aconteceu de verdade em
 * 2026-08-06: o CI mandou os 378 testes no exato momento de um `docker compose up
 * --build` da API e tomou 502 — job vermelho por uma janela de segundos, sem nada
 * quebrado. Sem essa distinção, todo deploy simultâneo a um push vira alarme falso, e
 * alarme falso repetido é como se volta a ignorar o vermelho.
 */
async function postWithRetry(url, body, token, attempts = 3) {
  const backoffMs = [2000, 6000]

  for (let i = 0; ; i++) {
    try {
      return await httpPost(url, body, token)
    } catch (e) {
      const transient = e.transient === true || (e.statusCode >= 500 && e.statusCode < 600)
      if (!transient || i >= attempts - 1) throw e

      const wait = backoffMs[Math.min(i, backoffMs.length - 1)]
      console.warn(`  ⚠ ${e.message} — tentativa ${i + 1}/${attempts}, nova tentativa em ${wait / 1000}s`)
      await new Promise((r) => setTimeout(r, wait))
    }
  }
}

// ── Execução por app ──────────────────────────────────────────────────────────

function runApp(app) {
  const outFile = join(tmpdir(), `rayzen-jest-${app}-${Date.now()}.json`)
  const jestArgs = ['--json', `--outputFile=${outFile}`, '--forceExit']
  if (coverage) jestArgs.push('--coverage')

  // Sem `--` entre o script e os args: no pnpm 10 ele deixou de ser separador e
  // chega ao jest como padrão de teste literal ("0 matches", nenhum arquivo gerado).
  process.stdout.write(`\n→ ${app}\n`)
  const proc = spawnSync('pnpm', ['--filter', app, 'test', ...jestArgs], {
    cwd: rootDir, encoding: 'utf8', shell: true, stdio: 'inherit',
  })

  if (!existsSync(outFile)) {
    return { app, ok: false, error: `sem arquivo de resultados (exit ${proc.status})` }
  }

  try {
    const json = JSON.parse(readFileSync(outFile, 'utf8'))
    unlinkSync(outFile)
    return {
      app,
      ok: true,
      total:   json.numTotalTests  ?? 0,
      passed:  json.numPassedTests ?? 0,
      failed:  json.numFailedTests ?? 0,
      results: jestToAllure(json, app),
    }
  } catch (e) {
    return { app, ok: false, error: `resultados ilegíveis: ${e.message}` }
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('→ Rayzen QA Ingest — monorepo')

  const cfg = await loadConfig()
  if (!dryRun) {
    if (!cfg.apiToken)  { console.error('✗ RAYZEN_API_TOKEN não configurado');  process.exit(1) }
    if (!cfg.projectId) { console.error('✗ RAYZEN_PROJECT_ID não configurado'); process.exit(1) }
  }

  const apps = discoverApps()
  if (apps.length === 0) { console.error('✗ Nenhum app com script `test` encontrado'); process.exit(1) }
  console.log(`→ Apps com testes: ${apps.join(', ')}`)

  const runs = apps.map(runApp)

  const broken = runs.filter((r) => !r.ok)
  for (const b of broken) console.error(`✗ ${b.app}: ${b.error}`)

  const good      = runs.filter((r) => r.ok)
  const allResults = good.flatMap((r) => r.results)
  const total     = good.reduce((a, r) => a + r.total, 0)
  const passed    = good.reduce((a, r) => a + r.passed, 0)
  const failed    = good.reduce((a, r) => a + r.failed, 0)

  console.log('\n── Resumo ──')
  for (const r of good) console.log(`   ${r.app.padEnd(10)} ${r.passed}/${r.total} passou${r.failed ? ` · ${r.failed} falhou` : ''}`)
  console.log(`   ${'TOTAL'.padEnd(10)} ${passed}/${total} passou${failed ? ` · ${failed} falhou` : ''}`)

  // Um app que não produziu resultados é falha dura: enviar um total parcial como se
  // fosse o repositório inteiro é exatamente o problema que este script veio resolver.
  if (broken.length > 0) {
    console.error(`\n✗ ${broken.length} app(s) sem resultados — abortando o envio para não gravar um total parcial`)
    process.exit(1)
  }

  if (dryRun) {
    console.log(`\n(dry-run) ${allResults.length} casos prontos para envio — nada foi enviado`)
    process.exit(failed > 0 ? 1 : 0)
  }

  const { branch, commitHash } = gitInfo()
  console.log(`\n→ Enviando para ${cfg.apiUrl}/qa/reports/ingest ...`)
  try {
    const res = await postWithRetry(
      `${cfg.apiUrl}/qa/reports/ingest`,
      {
        projectId:     cfg.projectId,
        tool:          process.env.GITHUB_ACTIONS ? 'github-actions' : 'jest',
        branch:        branch || undefined,
        commitHash:    commitHash || undefined,
        reportContent: JSON.stringify(allResults),
      },
      cfg.apiToken,
    )
    const runId = res?.id ?? res?.parsed?.id ?? '?'
    const rate  = total > 0 ? Math.round((passed / total) * 100) : 0
    console.log(`✓ Run salvo: ${runId} — ${total} testes, pass rate ${rate}%`)
  } catch (e) {
    console.error(`✗ Falha ao enviar: ${e.message}`)
    if (e.statusCode === 401 || e.statusCode === 403) {
      console.error('  Token recusado. O endpoint compara com o AGENT_TOKEN do servidor por string exata,')
      console.error('  não valida JWT — no CI, o secret RAYZEN_AGENT_TOKEN precisa ser idêntico ao do .env do servidor.')
    } else if (e.statusCode >= 500 || e.transient) {
      console.error('  API indisponível após as tentativas. Se houve deploy agora, rode de novo.')
    }
    process.exit(1)
  }

  process.exit(failed > 0 ? 1 : 0)
}

main().catch((e) => { console.error('✗', e.message); process.exit(1) })
