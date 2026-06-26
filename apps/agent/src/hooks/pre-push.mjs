#!/usr/bin/env node
// Guardian pre-push hook — blocks push if riskLevel === 'critical' and not overridden.
// Install with: pnpm guardian:install-hooks

import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { get as httpGet } from 'node:http'
import { get as httpsGet } from 'node:https'

function findRepoRoot(startDir) {
  let dir = startDir
  for (let i = 0; i < 10; i++) {
    if (existsSync(join(dir, '.git'))) return dir
    const parent = resolve(dir, '..')
    if (parent === dir) break
    dir = parent
  }
  return null
}

function parseEnv(filePath) {
  if (!existsSync(filePath)) return {}
  const env = {}
  for (const line of readFileSync(filePath, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx < 0) continue
    const k = trimmed.slice(0, eqIdx).trim()
    const v = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '')
    if (k) env[k] = v
  }
  return env
}

function fetchJson(url, token) {
  return new Promise((res, rej) => {
    const u = new URL(url)
    const lib = u.protocol === 'https:' ? httpsGet : httpGet
    const req = lib(
      {
        hostname: u.hostname,
        port:     u.port || (u.protocol === 'https:' ? 443 : 80),
        path:     u.pathname + u.search,
        method:   'GET',
        headers:  { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      },
      (r) => {
        let body = ''
        r.on('data', (c) => (body += c))
        r.on('end', () => {
          if (r.statusCode === 404) { res(null); return }
          try { res(JSON.parse(body)) } catch { res(null) }
        })
      },
    )
    req.on('error', rej)
    req.setTimeout(5000, () => req.destroy(new Error('timeout')))
  })
}

async function main() {
  const repoRoot = findRepoRoot(process.cwd()) ?? process.cwd()
  const env = { ...parseEnv(join(repoRoot, '.env')), ...process.env }

  if (env.AGENT_GUARDIAN_ENABLED === 'false') process.exit(0)

  const apiV2Url  = env.AGENT_API_V2_URL
  const token     = env.AGENT_TOKEN
  const projectId = env.GUARDIAN_PROJECT_ID

  // Fail open: if not configured, allow push
  if (!apiV2Url || !token || !projectId) process.exit(0)

  let report
  try {
    report = await fetchJson(`${apiV2Url}/v2/guardian/latest/${projectId}`, token)
  } catch {
    process.exit(0)
  }

  if (!report) process.exit(0)

  const { riskLevel, riskScore, summary, filesWithoutTests, id, overridden, deployRecommend } = report

  if (riskLevel === 'critical' && !overridden) {
    process.stderr.write(`\n🚨 GUARDIAN BLOQUEOU O PUSH\n`)
    process.stderr.write(`   Risk: CRITICAL (${riskScore})\n`)
    process.stderr.write(`   ${summary}\n`)
    if (filesWithoutTests?.length) {
      const shown = filesWithoutTests.slice(0, 3).join(', ')
      const extra = filesWithoutTests.length > 3 ? ` +${filesWithoutTests.length - 3}` : ''
      process.stderr.write(`   Sem spec: ${shown}${extra}\n`)
    }
    process.stderr.write(`   Deploy: ${deployRecommend}\n`)
    process.stderr.write(`\n   Para liberar manualmente:\n`)
    process.stderr.write(`   curl -X PATCH ${apiV2Url}/v2/guardian/${id}/override \\\n`)
    process.stderr.write(`     -H 'Authorization: Bearer <token>' \\\n`)
    process.stderr.write(`     -H 'Content-Type: application/json' \\\n`)
    process.stderr.write(`     -d '{"reason":"motivo aqui"}'\n`)
    process.stderr.write(`\n   Ou use git push --no-verify (sob sua responsabilidade)\n\n`)
    process.exit(1)
  }

  if (riskLevel === 'high') {
    process.stderr.write(`\n⚠️  Guardian: HIGH (${riskScore}) — ${summary}\n`)
    process.stderr.write(`   Push permitido. Revise antes de mergear.\n\n`)
  }

  process.exit(0)
}

main().catch(() => process.exit(0))
