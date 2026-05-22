'use strict'
import { execSync } from 'child_process'
import { resolve } from 'path'
import { isUnderSafeRoot } from '../utils/path-guard'

export type TestRunner = 'jest' | 'vitest' | 'playwright' | 'maven' | 'gradle' | 'pytest' | 'newman'

export interface TestRunResult {
  runner: TestRunner
  passed: number
  failed: number
  skipped: number
  total: number
  coverage?: CoverageResult
  failures: FailureInfo[]
  duration: string
  rawOutput: string
}

export interface CoverageResult {
  statements: number
  branches: number
  functions: number
  lines: number
}

export interface FailureInfo {
  test: string
  error: string
}

// ── Jest ─────────────────────────────────────────────────────────────────────

function parseJestOutput(output: string): Omit<TestRunResult, 'runner' | 'rawOutput'> {
  const passed  = parseInt(output.match(/(\d+)\s+passed/)?.[1]  ?? '0')
  const failed  = parseInt(output.match(/(\d+)\s+failed/)?.[1]  ?? '0')
  const skipped = parseInt(output.match(/(\d+)\s+skipped/)?.[1] ?? '0')
  const duration = output.match(/Time:\s+([\d.]+\s*\w+)/)?.[1] ?? 'n/a'

  const failures: FailureInfo[] = []
  for (const block of output.split(/\n●\s+/).slice(1)) {
    const lines = block.split('\n')
    const testName = lines[0]?.trim() ?? ''
    const error = lines.slice(1, 4).join(' ').trim()
    if (testName) failures.push({ test: testName, error })
  }

  let coverage: CoverageResult | undefined
  const cov = output.match(/All files\s+\|\s+([\d.]+)\s+\|\s+([\d.]+)\s+\|\s+([\d.]+)\s+\|\s+([\d.]+)/)
  if (cov) coverage = { statements: +cov[1], branches: +cov[2], functions: +cov[3], lines: +cov[4] }

  return { passed, failed, skipped, total: passed + failed + skipped, coverage, failures, duration }
}

// ── Playwright ────────────────────────────────────────────────────────────────

function parsePlaywrightOutput(output: string): Omit<TestRunResult, 'runner' | 'rawOutput'> {
  const passed  = parseInt(output.match(/(\d+)\s+passed/)?.[1]  ?? '0')
  const failed  = parseInt(output.match(/(\d+)\s+failed/)?.[1]  ?? '0')
  const skipped = parseInt(output.match(/(\d+)\s+skipped/)?.[1] ?? '0')
  const duration = output.match(/(\d+(?:\.\d+)?s)/)?.[1] ?? 'n/a'

  const failures: FailureInfo[] = []
  for (const line of output.split('\n')) {
    const m = line.match(/\s+\d+\)\s+(.+)/)
    if (m) failures.push({ test: m[1].trim(), error: '' })
  }

  return { passed, failed, skipped, total: passed + failed + skipped, failures, duration }
}

// ── Maven / Gradle ────────────────────────────────────────────────────────────
// Exemplo de linha Maven: Tests run: 10, Failures: 2, Errors: 1, Skipped: 0, Time elapsed: 1.23 s
// Acumula todos os suites e soma ao total

function parseMavenOutput(output: string): Omit<TestRunResult, 'runner' | 'rawOutput'> {
  let passed = 0, failed = 0, skipped = 0, errors = 0

  for (const line of output.split('\n')) {
    const m = line.match(/Tests run:\s*(\d+),\s*Failures:\s*(\d+),\s*Errors:\s*(\d+),\s*Skipped:\s*(\d+)/)
    if (m) {
      const run = +m[1], f = +m[2], e = +m[3], s = +m[4]
      failed   += f + e
      skipped  += s
      passed   += run - f - e - s
      errors   += e
    }
  }

  // Tempo total na última linha BUILD
  const duration = output.match(/BUILD\s+\w+\s+in\s+([\d.]+\s*\w+)/i)?.[1]
    ?? output.match(/Total time:\s+([\d.:]+\s*\w+)/)?.[1]
    ?? 'n/a'

  // Falhas: linhas com FAILED ou linhas após "<<< FAILURE!" com nome do teste
  const failures: FailureInfo[] = []
  const lines = output.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const failMatch = lines[i].match(/\[ERROR\]\s+(.+?)\((.+?)\)\s+(?:FAILED|ERROR)/)
    if (failMatch) {
      const test = `${failMatch[2]}#${failMatch[1]}`
      const error = lines[i + 1]?.trim() ?? ''
      failures.push({ test, error })
    }
  }

  void errors
  return { passed, failed, skipped, total: passed + failed + skipped, failures, duration }
}

// ── Pytest ────────────────────────────────────────────────────────────────────
// Exemplo: 5 passed, 2 failed, 1 error in 3.45s

function parsePytestOutput(output: string): Omit<TestRunResult, 'runner' | 'rawOutput'> {
  const summary = output.match(/([\d]+)\s+passed|failed|error/g) ?? []
  const passed  = parseInt(output.match(/(\d+)\s+passed/)?.[1]  ?? '0')
  const failed  = parseInt(output.match(/(\d+)\s+failed/)?.[1]  ?? '0')
  const errors  = parseInt(output.match(/(\d+)\s+error/)?.[1]   ?? '0')
  const skipped = parseInt(output.match(/(\d+)\s+skipped/)?.[1] ?? '0')
  const duration = output.match(/in\s+([\d.]+s)/)?.[1] ?? 'n/a'

  void summary
  const failures: FailureInfo[] = []
  for (const line of output.split('\n')) {
    // FAILED test_file.py::ClassName::test_method - AssertionError: ...
    const m = line.match(/^FAILED\s+(.+?)\s+-\s+(.+)/)
    if (m) failures.push({ test: m[1].trim(), error: m[2].trim() })
    // ERROR test_file.py::test_method
    const e = line.match(/^ERROR\s+(.+)/)
    if (e && !line.includes(' - ')) failures.push({ test: e[1].trim(), error: 'error' })
  }

  return { passed, failed: failed + errors, skipped, total: passed + failed + errors + skipped, failures, duration }
}

// ── Newman (Postman CLI) ──────────────────────────────────────────────────────
// Newman exibe uma tabela com assertions executed/failed

function parseNewmanOutput(output: string): Omit<TestRunResult, 'runner' | 'rawOutput'> {
  const assertionsLine = output.match(/assertions\s+\|\s+(\d+)\s+\|\s+(\d+)/)
  const passed  = assertionsLine ? +assertionsLine[1] - +assertionsLine[2] : 0
  const failed  = assertionsLine ? +assertionsLine[2] : 0
  const duration = output.match(/run duration:\s+([\d.]+\s*\w+)/i)?.[1]
    ?? output.match(/(\d+ms)/)?.[1]
    ?? 'n/a'

  const failures: FailureInfo[] = []
  for (const line of output.split('\n')) {
    // ✗ assertion name
    const m = line.match(/[✗#]\s+(.+)/)
    if (m) failures.push({ test: m[1].trim(), error: '' })
    // AssertionError / response body contains...
    const e = line.match(/AssertionError\s*[:-]\s*(.+)/)
    if (e && failures.length > 0) {
      failures[failures.length - 1].error = e[1].trim()
    }
  }

  return { passed, failed, skipped: 0, total: passed + failed, failures, duration }
}

// ── Main ──────────────────────────────────────────────────────────────────────

export async function runTests(payload: {
  projectPath?: string
  runner?: TestRunner
  coverage?: boolean
  filter?: string
  collectionPath?: string  // Newman: path to Postman collection JSON
  environment?: string     // Newman: path to environment JSON
}): Promise<TestRunResult> {
  const projectPath = payload.projectPath ?? 'C:\\Projects\\rayzen-ai'
  const resolved = resolve(projectPath)

  if (!isUnderSafeRoot(resolved)) {
    throw new Error(`Caminho não permitido: ${resolved}`)
  }

  const runner: TestRunner = payload.runner ?? 'jest'
  const filter = payload.filter

  let cmd: string
  let timeout = 120_000

  switch (runner) {
    case 'maven':
      cmd = filter
        ? `mvn test -Dtest="${filter}" -B`
        : 'mvn test -B'
      timeout = 300_000
      break

    case 'gradle': {
      const gradleCmd = process.platform === 'win32' ? 'gradlew.bat' : './gradlew'
      cmd = filter
        ? `${gradleCmd} test --tests "${filter}"`
        : `${gradleCmd} test`
      timeout = 300_000
      break
    }

    case 'pytest':
      cmd = filter
        ? `pytest -v --tb=short -k "${filter}"`
        : 'pytest -v --tb=short'
      timeout = 180_000
      break

    case 'newman': {
      const collection = payload.collectionPath ?? 'collection.json'
      const env = payload.environment ? ` -e "${payload.environment}"` : ''
      cmd = `newman run "${collection}"${env} --reporters cli`
      timeout = 120_000
      break
    }

    case 'playwright':
      cmd = filter ? `npx playwright test --grep "${filter}"` : 'npx playwright test'
      break

    case 'vitest':
      cmd = payload.coverage
        ? 'pnpm vitest run --coverage'
        : filter
        ? `pnpm vitest run --reporter=verbose -t "${filter}"`
        : 'pnpm vitest run'
      break

    default: // jest
      cmd = payload.coverage
        ? 'pnpm test:cov --forceExit'
        : filter
        ? `pnpm test --testNamePattern="${filter}" --forceExit`
        : 'pnpm test --forceExit'
  }

  let rawOutput = ''
  try {
    rawOutput = execSync(cmd, {
      cwd: resolved,
      encoding: 'utf-8',
      timeout,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
  } catch (err: unknown) {
    const execErr = err as { stdout?: string; stderr?: string }
    rawOutput = (execErr.stdout ?? '') + (execErr.stderr ?? '')
    if (!rawOutput) throw new Error(`Falha ao executar testes: ${(err as Error).message}`)
  }

  let parsed: Omit<TestRunResult, 'runner' | 'rawOutput'>
  switch (runner) {
    case 'maven':
    case 'gradle':
      parsed = parseMavenOutput(rawOutput)
      break
    case 'pytest':
      parsed = parsePytestOutput(rawOutput)
      break
    case 'newman':
      parsed = parseNewmanOutput(rawOutput)
      break
    case 'playwright':
      parsed = parsePlaywrightOutput(rawOutput)
      break
    default:
      parsed = parseJestOutput(rawOutput)
  }

  return { runner, ...parsed, rawOutput: rawOutput.slice(0, 4000) }
}
