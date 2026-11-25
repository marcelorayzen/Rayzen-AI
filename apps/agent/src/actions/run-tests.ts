'use strict'
import { existsSync, readFileSync } from 'fs'
import { resolve, join, dirname } from 'path'
import { isUnderSafeRoot } from '../utils/path-guard'
import { executarPrograma, ambientePadrao } from '../exec/executar-programa'

/**
 * Achado emergencial em 11/09, mesma classe de `git.ts`/`prisma.ts` — mesmo ponto cego do
 * scanner (`docs/exec-paths.md` só olha a mesma linha da chamada `execSync`; aqui `cmd` era
 * montado num `switch` várias linhas antes de chegar em `execSync(cmd, {...})`).
 *
 * Aqui era o PIOR dos três: **seis pontos de injeção**, um por runner, todos pela mesma
 * forma — `filter`/`collectionPath`/`environment` do payload, interpolados dentro de aspas
 * duplas: `` `pytest -k "${filter}"` ``, `` `mvn test -Dtest="${filter}" -B` ``, etc. É a
 * mesma técnica confirmada em `gitDiff`/`prisma.ts`: fecha a aspa com `"`, encadeia com `&`.
 * `jarvis:run_tests` é ação de uso diário, disponível ao role `desktop`.
 *
 * ## Três formas de invocar sem shell, uma por família de ferramenta
 *
 * | família | exemplo | estratégia |
 * |---|---|---|
 * | rodada por `pnpm` | jest, vitest | `entrypointJs('pnpm', ...)` — `pnpm.cmd` não tem lógica condicional, testado em Fase 1 |
 * | pacote local com `.bin/*.cmd` | playwright, newman | resolve o wrapper local e roda por `node`, mesma técnica de `prisma.ts` |
 * | binário externo com wrapper `.cmd`/`.bat` de forma desconhecida | mvn, gradle | `cmd.exe /c <script> <argv...>` com args como ELEMENTOS SEPARADOS — proibido para `pnpm`/`npx` (têm forma conhecida e mais segura), aceitável aqui porque não há como extrair o `.js` de um wrapper que invoca Java com classpath |
 *
 * A terceira forma foi medida antes de usar: `spawn('cmd.exe', ['/c', 'echo', 'a & echo X'],
 * {shell:false})` imprime `a & echo X` LITERAL — o Node quota cada elemento do argv ao
 * montar a linha de comando do Win32, então o `cmd.exe` nunca vê um `&` fora de aspas.
 * Continua sendo argv, nunca string montada.
 *
 * **Não verificado contra instalação real de playwright/newman** — nenhum dos dois está
 * presente neste monorepo. `mvn`/`gradle` também não. O que está provado é a técnica
 * (quoting de argv do Node no Windows) e o comportamento com `pnpm`, que já tem teste na
 * Fase 1. Ver `docs/plano-execucao-tipada.md`.
 */

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

// ── Invocação sem shell ────────────────────────────────────────────────────────

/**
 * Resolve o `.cmd` local de um pacote instalado (`<cwd>/node_modules/.bin/<nome>.cmd`),
 * andando para cima no diretório até achar — mesma busca que o Node faz para `node_modules`,
 * escopada ao PROJETO ALVO. Reusa o parser de wrapper de `resolverEntrypointJs` (mesmo
 * formato `%~dp0\node.exe %~dp0\...\*.js` que `.bin` de pacote Node sempre tem).
 */
function localBinCmd(nome: string, cwd: string): string | null {
  let dir = resolve(cwd)
  for (;;) {
    const candidato = join(dir, 'node_modules', '.bin', `${nome}.cmd`)
    if (existsSync(candidato)) return candidato
    const pai = dirname(dir)
    if (pai === dir) return null
    dir = pai
  }
}

async function rodarViaPnpm(args: string[], cwd: string, timeoutMs: number): Promise<string> {
  const r = await executarPrograma('entrypointJs', 'pnpm', args, { cwd, env: ambientePadrao(), timeoutMs })
  return juntarSaida(r)
}

/** Playwright/newman: pacote local, `.bin/<nome>.cmd` — mesma técnica de `prisma.ts`. */
async function rodarBinLocal(nome: string, args: string[], cwd: string, timeoutMs: number): Promise<string> {
  const wrapper = localBinCmd(nome, cwd)
  if (!wrapper) throw new Error(`"${nome}" não encontrado em node_modules/.bin de ${cwd}.`)
  const conteudo = readFileSync(wrapper, 'utf8')
  const m = conteudo.match(/%~dp0\\?([^"%\r\n]+\.js)/i)
  if (!m) throw new Error(`Não consegui extrair o .js do wrapper de "${nome}" (${wrapper}).`)
  const js = join(dirname(wrapper), m[1])
  const r = await executarPrograma('executavel', 'node', [js, ...args], { cwd, env: ambientePadrao(), timeoutMs })
  return juntarSaida(r)
}

/**
 * `mvn`/`gradle`: wrapper `.cmd`/`.bat` que invoca Java com classpath — sem forma simples
 * para extrair. `cmd.exe /c <script> <argv...>`, argv como ELEMENTOS SEPARADOS: medido em
 * 11/09 que o Node cota cada elemento ao montar a linha do Win32, então `&`/`|` num valor
 * nunca escapam da própria aspa — o `cmd.exe` não vê metacaractere solto.
 */
async function rodarViaCmdScript(script: string, args: string[], cwd: string, timeoutMs: number): Promise<string> {
  const r = await executarPrograma('executavel', 'cmd.exe', ['/c', script, ...args], { cwd, env: ambientePadrao(), timeoutMs })
  return juntarSaida(r)
}

/**
 * Teste que FALHA sai com código != 0 — isso é normal, não é erro de execução. A saída
 * (que o parser de cada runner precisa) vem de qualquer forma; só lança se não houver saída
 * NENHUMA, o que indica que o binário nem chegou a rodar (mesma semântica do código antigo,
 * que só relançava quando `stdout`/`stderr` do erro capturado vinham vazios).
 */
function juntarSaida(r: { stdout: string; stderr: string; code: number | null }): string {
  const saida = (r.stdout + (r.stderr ? `\n${r.stderr}` : '')).trim()
  if (!saida && r.code !== 0) {
    throw new Error(`Falha ao executar testes: processo saiu com código ${r.code} sem produzir saída.`)
  }
  return saida
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
  const projectPath = payload.projectPath ?? process.cwd()
  const resolved = resolve(projectPath)

  if (!isUnderSafeRoot(resolved)) {
    throw new Error(`Caminho não permitido: ${resolved}`)
  }

  const runner: TestRunner = payload.runner ?? 'jest'
  const filter = payload.filter

  let timeout = 120_000
  let rawOutput: string

  switch (runner) {
    case 'maven':
      timeout = 300_000
      rawOutput = await rodarViaCmdScript(
        'mvn', filter ? ['test', `-Dtest=${filter}`, '-B'] : ['test', '-B'],
        resolved, timeout,
      )
      break

    case 'gradle': {
      timeout = 300_000
      const gradleScript = process.platform === 'win32' ? 'gradlew.bat' : './gradlew'
      rawOutput = await rodarViaCmdScript(
        gradleScript, filter ? ['test', '--tests', filter] : ['test'],
        resolved, timeout,
      )
      break
    }

    case 'pytest':
      timeout = 180_000
      // `pytest` no Windows é um .exe de verdade (launcher do pip), não wrapper .cmd —
      // `executavel` direto, sem entrypointJs nem cmd.exe /c.
      rawOutput = juntarSaida(await executarPrograma(
        'executavel', 'pytest',
        filter ? ['-v', '--tb=short', '-k', filter] : ['-v', '--tb=short'],
        { cwd: resolved, env: ambientePadrao(), timeoutMs: timeout },
      ))
      break

    case 'newman': {
      const collection = payload.collectionPath ?? 'collection.json'
      const args = ['run', collection, '--reporters', 'cli']
      if (payload.environment) args.push('-e', payload.environment)
      rawOutput = await rodarBinLocal('newman', args, resolved, timeout)
      break
    }

    case 'playwright':
      rawOutput = await rodarBinLocal(
        'playwright', filter ? ['test', '--grep', filter] : ['test'],
        resolved, timeout,
      )
      break

    case 'vitest':
      rawOutput = await rodarViaPnpm(
        payload.coverage
          ? ['vitest', 'run', '--coverage']
          : filter
          ? ['vitest', 'run', '--reporter=verbose', '-t', filter]
          : ['vitest', 'run'],
        resolved, timeout,
      )
      break

    default: // jest
      rawOutput = await rodarViaPnpm(
        payload.coverage
          ? ['test:cov', '--forceExit']
          : filter
          ? ['test', `--testNamePattern=${filter}`, '--forceExit']
          : ['test', '--forceExit'],
        resolved, timeout,
      )
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
