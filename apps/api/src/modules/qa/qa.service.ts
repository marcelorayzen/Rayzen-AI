import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import { MemoryService } from '../memory/memory.service'

export interface FailedCase {
  suite: string
  name: string
  message: string
  stacktrace: string
}

export interface TestSuite {
  name: string
  tests: number
  failures: number
  durationMs: number
}

export interface ParsedTestRun {
  tool: string
  totalTests: number
  passed: number
  failed: number
  skipped: number
  durationMs: number
  suites: TestSuite[]
  failedCases: FailedCase[]
}

export interface SaveTestRunDto extends ParsedTestRun {
  projectId?: string
  branch?: string
  commitHash?: string
  source?: 'agent' | 'ci' | 'manual'
}

// ── Parsers ───────────────────────────────────────────────────────────────────

function attr(tag: string, name: string): string {
  const m = tag.match(new RegExp(`${name}="([^"]*)"`, 'i'))
  return m?.[1] ?? ''
}

function num(tag: string, name: string, fallback = 0): number {
  const v = parseFloat(attr(tag, name))
  return isNaN(v) ? fallback : v
}

export function parseJUnitXML(xml: string): ParsedTestRun {
  // Suites — <testsuite ...>
  const suites: TestSuite[] = []
  const suiteMatches = xml.matchAll(/<testsuite\s([^>]*)>/gi)
  for (const m of suiteMatches) {
    suites.push({
      name: attr(m[1], 'name'),
      tests: num(m[1], 'tests'),
      failures: num(m[1], 'failures') + num(m[1], 'errors'),
      durationMs: Math.round(num(m[1], 'time') * 1000),
    })
  }

  // Root totals — prefer <testsuites> tag, fallback to sum
  const rootMatch = xml.match(/<testsuites\s([^>]*)>/)
  const rootTag = rootMatch?.[1] ?? ''
  const totalTests = num(rootTag, 'tests') || suites.reduce((s, x) => s + x.tests, 0)
  const failed = num(rootTag, 'failures') + num(rootTag, 'errors')
    || suites.reduce((s, x) => s + x.failures, 0)
  const skipped = num(rootTag, 'skipped')
  const passed = totalTests - failed - skipped
  const durationMs = Math.round(num(rootTag, 'time') * 1000)
    || suites.reduce((s, x) => s + x.durationMs, 0)

  // Failed cases — <testcase ...><failure ...>...</failure></testcase>
  const failedCases: FailedCase[] = []
  const caseBlocks = xml.matchAll(/<testcase\s([^>]*)>([\s\S]*?)<\/testcase>/gi)
  for (const m of caseBlocks) {
    const inner = m[2]
    if (!/<failure|<error/i.test(inner)) continue
    const tagAttrs = m[1]
    const failMatch = inner.match(/<(?:failure|error)\s*([^>]*)>([\s\S]*?)<\/(?:failure|error)>/i)
    const msgAttr = failMatch ? attr(failMatch[1], 'message') : ''
    const stacktrace = failMatch ? failMatch[2].trim().slice(0, 1000) : ''
    failedCases.push({
      suite: attr(tagAttrs, 'classname') || attr(tagAttrs, 'name'),
      name: attr(tagAttrs, 'name'),
      message: msgAttr,
      stacktrace,
    })
  }

  return { tool: 'junit', totalTests, passed, failed, skipped, durationMs, suites, failedCases }
}

export function parseAllureJSON(raw: string): ParsedTestRun {
  const results = JSON.parse(raw) as Array<{
    name: string
    status: string
    duration?: number
    statusDetails?: { message?: string; trace?: string }
    labels?: Array<{ name: string; value: string }>
  }>

  let passed = 0, failed = 0, skipped = 0, totalMs = 0
  const failedCases: FailedCase[] = []

  for (const r of results) {
    totalMs += r.duration ?? 0
    if (r.status === 'passed') passed++
    else if (r.status === 'skipped' || r.status === 'pending') skipped++
    else {
      failed++
      const suite = r.labels?.find(l => l.name === 'suite')?.value ?? ''
      failedCases.push({
        suite,
        name: r.name,
        message: r.statusDetails?.message ?? r.status,
        stacktrace: (r.statusDetails?.trace ?? '').slice(0, 1000),
      })
    }
  }

  return {
    tool: 'allure',
    totalTests: results.length,
    passed,
    failed,
    skipped,
    durationMs: Math.round(totalMs),
    suites: [],
    failedCases,
  }
}

// ── Service ───────────────────────────────────────────────────────────────────

@Injectable()
export class QaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly memory: MemoryService,
  ) {}

  async saveRun(dto: SaveTestRunDto): Promise<{ id: string }> {
    const run = await this.prisma.testRun.create({
      data: {
        projectId: dto.projectId ?? null,
        tool: dto.tool,
        branch: dto.branch ?? null,
        commitHash: dto.commitHash ?? null,
        totalTests: dto.totalTests,
        passed: dto.passed,
        failed: dto.failed,
        skipped: dto.skipped,
        durationMs: dto.durationMs ?? null,
        suites: dto.suites as object[],
        failedCases: dto.failedCases as object[],
        source: dto.source ?? 'agent',
      },
    })

    // Indexa falhas no pgvector para busca semântica futura
    if (dto.failedCases.length > 0) {
      const text = dto.failedCases
        .map(f => `Teste falhou: ${f.suite} > ${f.name}\n${f.message}\n${f.stacktrace}`)
        .join('\n\n')
        .slice(0, 6000)

      this.memory.indexDocument(
        text,
        `qa/test-run/${run.id}`,
        { type: 'test_failures', tool: dto.tool, runId: run.id },
        dto.projectId,
      ).catch(() => null)
    }

    return { id: run.id }
  }

  async getRuns(projectId?: string, limit = 20) {
    return this.prisma.testRun.findMany({
      where: projectId ? { projectId } : {},
      orderBy: { executedAt: 'desc' },
      take: limit,
      select: {
        id: true, tool: true, branch: true, commitHash: true,
        totalTests: true, passed: true, failed: true, skipped: true,
        durationMs: true, source: true, executedAt: true,
      },
    })
  }

  async getFailurePatterns(projectId?: string, lastNRuns = 10) {
    const runs = await this.prisma.testRun.findMany({
      where: projectId ? { projectId } : {},
      orderBy: { executedAt: 'desc' },
      take: lastNRuns,
      select: { failedCases: true, executedAt: true },
    })

    const freq: Record<string, { count: number; lastSeen: string; messages: string[] }> = {}

    for (const run of runs) {
      const cases = run.failedCases as unknown as FailedCase[]
      for (const c of cases) {
        const key = `${c.suite} > ${c.name}`
        if (!freq[key]) freq[key] = { count: 0, lastSeen: '', messages: [] }
        freq[key].count++
        freq[key].lastSeen = run.executedAt.toISOString()
        if (!freq[key].messages.includes(c.message)) freq[key].messages.push(c.message)
      }
    }

    return Object.entries(freq)
      .sort(([, a], [, b]) => b.count - a.count)
      .slice(0, 20)
      .map(([test, data]) => ({ test, ...data }))
  }

  async getQualityTrend(projectId?: string, days = 30) {
    const since = new Date(Date.now() - days * 86400_000)
    const runs = await this.prisma.testRun.findMany({
      where: {
        ...(projectId ? { projectId } : {}),
        executedAt: { gte: since },
      },
      orderBy: { executedAt: 'asc' },
      select: { passed: true, failed: true, skipped: true, totalTests: true, executedAt: true },
    })

    return runs.map((r: { passed: number; failed: number; skipped: number; totalTests: number; executedAt: Date }) => ({
      date: r.executedAt.toISOString().slice(0, 10),
      passRate: r.totalTests > 0 ? Math.round((r.passed / r.totalTests) * 100) : 0,
      total: r.totalTests,
      failed: r.failed,
    }))
  }

  async getFlakyTests(projectId?: string, lastNRuns = 20) {
    const runs = await this.prisma.testRun.findMany({
      where: projectId ? { projectId } : {},
      orderBy: { executedAt: 'desc' },
      take: lastNRuns,
      select: { failedCases: true, totalTests: true, passed: true, executedAt: true },
    })

    // Conta em quantos runs cada teste apareceu como falha
    const failCount: Record<string, number> = {}
    const totalRuns = runs.length

    for (const run of runs) {
      const seen = new Set<string>()
      for (const c of run.failedCases as unknown as FailedCase[]) {
        const key = `${c.suite} > ${c.name}`
        if (!seen.has(key)) { seen.add(key); failCount[key] = (failCount[key] ?? 0) + 1 }
      }
    }

    // Flaky = falhou em pelo menos 20% mas menos de 80% dos runs (não é falha consistente)
    return Object.entries(failCount)
      .map(([test, count]) => ({ test, failRate: Math.round((count / totalRuns) * 100), failedIn: count, totalRuns }))
      .filter(t => t.failRate >= 20 && t.failRate < 80)
      .sort((a, b) => b.failRate - a.failRate)
  }

  async getSummary(projectId?: string) {
    const [lastRuns, patterns, flaky] = await Promise.all([
      this.getRuns(projectId, 5),
      this.getFailurePatterns(projectId, 10),
      this.getFlakyTests(projectId, 20),
    ])

    const last = lastRuns[0]
    return {
      lastRun: last
        ? { date: last.executedAt, tool: last.tool, total: last.totalTests, passed: last.passed, failed: last.failed, passRate: last.totalTests > 0 ? Math.round((last.passed / last.totalTests) * 100) : 0 }
        : null,
      totalRuns: lastRuns.length,
      topFailures: patterns.slice(0, 5),
      flakyTests: flaky.slice(0, 5),
    }
  }

  async ingestFromCi(dto: {
    content: string
    format: 'junit' | 'allure' | 'auto'
    tool?: string
    projectName?: string
    projectId?: string
    branch?: string
    commitHash?: string
  }): Promise<{ id: string; parsed: ParsedTestRun }> {
    const parsed = this.parseReport(dto.content, dto.format)

    // Resolve projectId pelo nome se não vier explícito
    let projectId = dto.projectId
    if (!projectId && dto.projectName) {
      const found = await this.prisma.project.findFirst({
        where: { name: { equals: dto.projectName, mode: 'insensitive' } },
        select: { id: true },
      })
      if (found) projectId = found.id
    }

    if (dto.tool) parsed.tool = dto.tool

    const { id } = await this.saveRun({
      ...parsed,
      projectId,
      branch: dto.branch,
      commitHash: dto.commitHash,
      source: 'ci',
    })

    return { id, parsed }
  }

  parseReport(content: string, format: 'junit' | 'allure' | 'auto'): ParsedTestRun {
    if (format === 'allure' || (format === 'auto' && content.trimStart().startsWith('['))) {
      return parseAllureJSON(content)
    }
    return parseJUnitXML(content)
  }
}
