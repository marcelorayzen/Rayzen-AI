import { readFileSync, existsSync } from 'node:fs'
import { extname, resolve } from 'node:path'
import { request } from 'node:http'
import { request as httpsRequest } from 'node:https'

const HOME = process.env.USERPROFILE ?? process.env.HOME ?? ''
const SAFE_ROOTS = [HOME + '\\Projects', 'C:\\Projects', 'D:\\Projects', HOME + '\\Desktop']

export interface ParsedTestRun {
  tool: string
  totalTests: number
  passed: number
  failed: number
  skipped: number
  durationMs: number
  suites: Array<{ name: string; tests: number; failures: number; durationMs: number }>
  failedCases: Array<{ suite: string; name: string; message: string; stacktrace: string }>
}

// ── Parsers locais (mirror do qa.service.ts da API) ──────────────────────────

function attr(tag: string, name: string): string {
  const m = tag.match(new RegExp(`${name}="([^"]*)"`, 'i'))
  return m?.[1] ?? ''
}

function num(tag: string, name: string, fallback = 0): number {
  const v = parseFloat(attr(tag, name))
  return isNaN(v) ? fallback : v
}

function parseJUnitXML(xml: string): ParsedTestRun {
  const suites: ParsedTestRun['suites'] = []
  for (const m of xml.matchAll(/<testsuite\s([^>]*)>/gi)) {
    suites.push({
      name: attr(m[1], 'name'),
      tests: num(m[1], 'tests'),
      failures: num(m[1], 'failures') + num(m[1], 'errors'),
      durationMs: Math.round(num(m[1], 'time') * 1000),
    })
  }

  const rootMatch = xml.match(/<testsuites\s([^>]*)>/)
  const rootTag = rootMatch?.[1] ?? ''
  const totalTests = num(rootTag, 'tests') || suites.reduce((s, x) => s + x.tests, 0)
  const failed = num(rootTag, 'failures') + num(rootTag, 'errors')
    || suites.reduce((s, x) => s + x.failures, 0)
  const skipped = num(rootTag, 'skipped')
  const passed = totalTests - failed - skipped
  const durationMs = Math.round(num(rootTag, 'time') * 1000)
    || suites.reduce((s, x) => s + x.durationMs, 0)

  const failedCases: ParsedTestRun['failedCases'] = []
  for (const m of xml.matchAll(/<testcase\s([^>]*)>([\s\S]*?)<\/testcase>/gi)) {
    const inner = m[2]
    if (!/<failure|<error/i.test(inner)) continue
    const tagAttrs = m[1]
    const failMatch = inner.match(/<(?:failure|error)\s*([^>]*)>([\s\S]*?)<\/(?:failure|error)>/i)
    failedCases.push({
      suite: attr(tagAttrs, 'classname') || attr(tagAttrs, 'name'),
      name: attr(tagAttrs, 'name'),
      message: failMatch ? attr(failMatch[1], 'message') : '',
      stacktrace: failMatch ? failMatch[2].trim().slice(0, 800) : '',
    })
  }

  return { tool: 'junit', totalTests, passed, failed, skipped, durationMs, suites, failedCases }
}

function parseAllureJSON(raw: string): ParsedTestRun {
  const results = JSON.parse(raw) as Array<{
    name: string; status: string; duration?: number
    statusDetails?: { message?: string; trace?: string }
    labels?: Array<{ name: string; value: string }>
  }>

  let passed = 0, failed = 0, skipped = 0, totalMs = 0
  const failedCases: ParsedTestRun['failedCases'] = []

  for (const r of results) {
    totalMs += r.duration ?? 0
    if (r.status === 'passed') passed++
    else if (r.status === 'skipped' || r.status === 'pending') skipped++
    else {
      failed++
      failedCases.push({
        suite: r.labels?.find(l => l.name === 'suite')?.value ?? '',
        name: r.name,
        message: r.statusDetails?.message ?? r.status,
        stacktrace: (r.statusDetails?.trace ?? '').slice(0, 800),
      })
    }
  }

  return { tool: 'allure', totalTests: results.length, passed, failed, skipped, durationMs: Math.round(totalMs), suites: [], failedCases }
}

// ── Envio para API ────────────────────────────────────────────────────────────

function postToApi(apiUrl: string, token: string, body: object): Promise<number> {
  return new Promise(resolve => {
    const payload = JSON.stringify(body)
    const parsed = new URL(`${apiUrl}/qa/reports`)
    const isHttps = parsed.protocol === 'https:'
    const lib = isHttps ? httpsRequest : request
    const req = lib({
      hostname: parsed.hostname,
      port: parsed.port || (isHttps ? 443 : 80),
      path: parsed.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        'Authorization': `Bearer ${token}`,
      },
    }, res => { res.resume(); resolve(res.statusCode ?? 0) })
    req.on('error', () => resolve(0))
    req.setTimeout(8000, () => { req.destroy(); resolve(0) })
    req.write(payload)
    req.end()
  })
}

// ── Main ──────────────────────────────────────────────────────────────────────

export async function parseTestReport(payload: {
  reportPath: string
  format?: 'junit' | 'allure' | 'auto'
  projectId?: string
  branch?: string
  commitHash?: string
}): Promise<ParsedTestRun & { saved: boolean }> {
  const reportPath = resolve(payload.reportPath)

  if (!SAFE_ROOTS.some(r => reportPath.startsWith(r))) {
    throw new Error(`Caminho não permitido: ${reportPath}`)
  }

  if (!existsSync(reportPath)) {
    throw new Error(`Arquivo não encontrado: ${reportPath}`)
  }

  const content = readFileSync(reportPath, 'utf-8')
  const ext = extname(reportPath).toLowerCase()

  let format = payload.format ?? 'auto'
  if (format === 'auto') {
    format = ext === '.json' ? 'allure' : 'junit'
  }

  const parsed = format === 'allure' ? parseAllureJSON(content) : parseJUnitXML(content)

  // Envia para a API para persistência e indexação semântica
  const apiUrl = process.env.AGENT_API_URL ?? 'http://localhost:3101'
  const token = process.env.AGENT_TOKEN ?? ''
  let saved = false

  if (token) {
    const status = await postToApi(apiUrl, token, {
      ...parsed,
      projectId: payload.projectId,
      branch: payload.branch,
      commitHash: payload.commitHash,
      source: 'agent',
    })
    saved = status === 201
  }

  return { ...parsed, saved }
}
