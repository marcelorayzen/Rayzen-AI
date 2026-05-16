import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { resolve, join, basename, extname } from 'node:path'
import { request } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { takeScreenshot } from './screenshot'

const HOME = process.env.USERPROFILE ?? process.env.HOME ?? ''
const SAFE_ROOTS = [HOME + '\\Projects', HOME + '\\Desktop', 'C:\\Projects', 'D:\\Projects']

interface FailedCase {
  suite: string
  name: string
  message: string
  stacktrace: string
  screenshotPath?: string
}

interface CaptureResult {
  total: number
  failed: number
  captured: FailedCase[]
  screenshotsTaken: string[]
  indexed: boolean
  reportDir: string
}

// ── JUnit XML parser (lê múltiplos arquivos de um diretório) ──────────────────

function attr(tag: string, name: string): string {
  return tag.match(new RegExp(`${name}="([^"]*)"`, 'i'))?.[1] ?? ''
}

function num(tag: string, name: string): number {
  const v = parseFloat(attr(tag, name))
  return isNaN(v) ? 0 : v
}

function parseJUnitDir(dir: string): { total: number; failed: number; cases: FailedCase[] } {
  const files = readdirSync(dir).filter(f => f.endsWith('.xml') && f.startsWith('TEST-'))
  let total = 0
  let failed = 0
  const cases: FailedCase[] = []

  for (const file of files) {
    const xml = readFileSync(join(dir, file), 'utf-8')

    // Contar totais do suite
    const suiteMatch = xml.match(/<testsuite\s([^>]*)>/)
    if (suiteMatch) {
      total  += num(suiteMatch[1], 'tests')
      failed += num(suiteMatch[1], 'failures') + num(suiteMatch[1], 'errors')
    }

    // Extrair casos com falha
    for (const m of xml.matchAll(/<testcase\s([^>]*)>([\s\S]*?)<\/testcase>/gi)) {
      const inner = m[2]
      if (!/<failure|<error/i.test(inner)) continue

      const tagAttrs = m[1]
      const failMatch = inner.match(/<(?:failure|error)\s*([^>]*)>([\s\S]*?)<\/(?:failure|error)>/i)
      cases.push({
        suite: attr(tagAttrs, 'classname') || attr(tagAttrs, 'name'),
        name:  attr(tagAttrs, 'name'),
        message:    failMatch ? attr(failMatch[1], 'message') : '',
        stacktrace: failMatch ? failMatch[2].replace(/<!\[CDATA\[|\]\]>/g, '').trim().slice(0, 600) : '',
      })
    }
  }

  return { total, failed, cases }
}

// ── Matching de screenshots ───────────────────────────────────────────────────
// Selenium salva screenshots com o nome do teste — tenta casar por substring

function findScreenshot(screenshotDir: string, testName: string): string | undefined {
  if (!existsSync(screenshotDir)) return undefined
  try {
    const files = readdirSync(screenshotDir).filter(f => ['.png', '.jpg', '.jpeg'].includes(extname(f).toLowerCase()))
    // normaliza: tira prefixos de classe, deixa só o nome do método
    const method = testName.split('.').pop()?.toLowerCase() ?? testName.toLowerCase()
    const match = files.find(f => f.toLowerCase().includes(method))
    return match ? join(screenshotDir, match) : undefined
  } catch { return undefined }
}

// ── Envio para API ────────────────────────────────────────────────────────────

function postJson(url: string, token: string, body: object): Promise<boolean> {
  return new Promise(resolve => {
    const payload = JSON.stringify(body)
    const parsed = new URL(url)
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
    }, res => { res.resume(); resolve(res.statusCode === 201 || res.statusCode === 200) })
    req.on('error', () => resolve(false))
    req.setTimeout(8000, () => { req.destroy(); resolve(false) })
    req.write(payload)
    req.end()
  })
}

// ── Formata conteúdo para indexação semântica ─────────────────────────────────

function formatForMemory(cases: FailedCase[], reportDir: string): string {
  const ts = new Date().toLocaleString('pt-BR')
  const lines: string[] = [
    `# Falhas de Teste — ${ts}`,
    `Diretório: ${reportDir}`,
    `Total de falhas: ${cases.length}`,
    '',
  ]

  for (const c of cases) {
    lines.push(`## FALHA: ${c.suite}#${c.name}`)
    if (c.message)    lines.push(`Mensagem: ${c.message}`)
    if (c.stacktrace) lines.push(`Stack:\n${c.stacktrace}`)
    if (c.screenshotPath) lines.push(`Screenshot: ${c.screenshotPath}`)
    lines.push('')
  }

  return lines.join('\n')
}

// ── Main ──────────────────────────────────────────────────────────────────────

export async function captureTestFailure(payload: {
  projectPath?: string
  reportDir?: string        // default: target/surefire-reports (maven) ou build/test-results/test (gradle)
  screenshotDir?: string    // onde o Selenium salva screenshots — opcional
  projectId?: string
  takeScreenshotOnFailure?: boolean  // tira screenshot do sistema se houver falhas (default: true)
}): Promise<CaptureResult> {
  const projectPath = resolve(payload.projectPath ?? 'C:\\Projects')
  if (!SAFE_ROOTS.some(r => projectPath.startsWith(r))) {
    throw new Error(`Caminho não permitido: ${projectPath}`)
  }

  // Detecta diretório de relatórios automaticamente
  let reportDirRel = payload.reportDir
  if (!reportDirRel) {
    const mavenDir  = join(projectPath, 'target', 'surefire-reports')
    const gradleDir = join(projectPath, 'build', 'test-results', 'test')
    if (existsSync(mavenDir))       reportDirRel = 'target/surefire-reports'
    else if (existsSync(gradleDir)) reportDirRel = 'build/test-results/test'
    else throw new Error('Diretório de relatórios não encontrado. Informe reportDir explicitamente.')
  }

  const reportDir    = resolve(join(projectPath, reportDirRel))
  const screenshotDir = payload.screenshotDir ? resolve(join(projectPath, payload.screenshotDir)) : undefined

  if (!existsSync(reportDir)) {
    throw new Error(`Diretório de relatórios não existe: ${reportDir}. Execute os testes primeiro.`)
  }

  // Parseia todos os XMLs do diretório
  const { total, failed, cases } = parseJUnitDir(reportDir)

  // Casa screenshots com as falhas
  const screenshotsTaken: string[] = []
  for (const c of cases) {
    if (screenshotDir) {
      const shot = findScreenshot(screenshotDir, c.name)
      if (shot) { c.screenshotPath = shot; screenshotsTaken.push(shot) }
    }
  }

  // Tira screenshot do sistema se há falhas e não encontrou nenhuma do Selenium
  const shouldAutoScreenshot = (payload.takeScreenshotOnFailure ?? true) && cases.length > 0 && screenshotsTaken.length === 0
  if (shouldAutoScreenshot) {
    try {
      const shot = await takeScreenshot()
      screenshotsTaken.push(shot.path)
      // Associa a primeira falha sem screenshot
      const first = cases.find(c => !c.screenshotPath)
      if (first) first.screenshotPath = shot.path
    } catch { /* não crítico */ }
  }

  // Indexa no projeto se tiver token e falhas
  let indexed = false
  const apiUrl = process.env.AGENT_API_URL ?? 'http://localhost:3101'
  const token  = process.env.AGENT_TOKEN ?? ''

  if (token && cases.length > 0) {
    const content = formatForMemory(cases, reportDir)
    const sourcePath = `qa/falhas/${basename(projectPath)}/${new Date().toISOString().slice(0, 10)}`
    indexed = await postJson(`${apiUrl}/memory/index`, token, {
      content,
      sourcePath,
      projectId: payload.projectId,
      metadata: { type: 'test_failure', failedCount: cases.length, total, runner: 'junit' },
    })
  }

  return { total, failed, captured: cases, screenshotsTaken, indexed, reportDir }
}
