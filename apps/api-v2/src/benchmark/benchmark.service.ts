import { Injectable, Logger } from '@nestjs/common'
import { PrismaV2Service } from '../core/prisma-v2.service'
import { LlmService } from '../llm/llm.service'

export interface BenchmarkRunOptions {
  strategyId:  string
  taskType?:   string
  goldenOnly?: boolean
  limit?:      number
  systemPrompt?: string
  model?:      string
}

export interface BenchmarkRunResult {
  strategyId: string
  total:      number
  avgFitness: number
  avgAccuracy: number
  avgCostUsd:  number
  avgLatencyMs: number
  results:    Array<{ caseId: string; fitness: number; accuracy: number }>
}

@Injectable()
export class BenchmarkService {
  private readonly logger = new Logger(BenchmarkService.name)

  constructor(
    private readonly prisma: PrismaV2Service,
    private readonly llm:    LlmService,
  ) {}

  async extractFromTraces(limit = 20, projectId?: string): Promise<number> {
    const where = projectId
      ? { attributes: { path: ['projectId'], equals: projectId }, status: 'ok' }
      : { status: 'ok' }

    const spans = await this.prisma.traceSpan.findMany({
      where,
      orderBy: { startedAt: 'desc' },
      take: limit * 3, // over-fetch para filtrar os úteis
    })

    let created = 0
    for (const span of spans) {
      const attrs = span.attributes as Record<string, unknown>
      const input    = attrs['prompt']    as string | undefined
      const expected = attrs['response']  as string | undefined
      const taskType = attrs['operation'] as string | undefined ?? span.operation

      if (!input || !expected || input.length < 20) continue

      await this.prisma.benchmarkCase.create({
        data: {
          taskType,
          input,
          expected,
          source:    'trace',
          projectId: attrs['projectId'] as string ?? projectId ?? null,
          approved:  false,
        },
      })
      created++
      if (created >= limit) break
    }

    this.logger.log(`extractFromTraces: criados ${created} casos a partir de ${spans.length} spans`)
    return created
  }

  async runForStrategy(opts: BenchmarkRunOptions): Promise<BenchmarkRunResult> {
    const cases = await this.prisma.benchmarkCase.findMany({
      where: {
        ...(opts.taskType   ? { taskType: opts.taskType }  : {}),
        ...(opts.goldenOnly ? { approved: true }            : {}),
      },
      take: opts.limit ?? 20,
    })

    if (cases.length === 0) {
      return { strategyId: opts.strategyId, total: 0, avgFitness: 0, avgAccuracy: 0, avgCostUsd: 0, avgLatencyMs: 0, results: [] }
    }

    const systemPrompt = opts.systemPrompt ?? 'You are a helpful assistant. Complete the task precisely.'
    const results: BenchmarkRunResult['results'] = []
    let totalFitness = 0, totalAccuracy = 0, totalCost = 0, totalLatency = 0

    for (const c of cases) {
      const t0 = Date.now()
      let output = ''
      let tokensUsed = 0

      try {
        const res = await this.llm.chat([
          { role: 'system', content: systemPrompt },
          { role: 'user',   content: c.input },
        ], { model: opts.model ?? 'gpt-4o-mini', temperature: 0 })
        output     = res.content
        tokensUsed = res.tokensUsed
      } catch (e) {
        this.logger.warn(`LLM call failed for case ${c.id}: ${e}`)
        output = ''
      }

      const latencyMs = Date.now() - t0
      const accuracy  = await this.evaluateAccuracy(c.input, c.expected, output)
      const costUsd   = tokensUsed * 0.0000001 // estimativa flat; sobrescrever via CostRecord se necessário
      const fitness   = this.calcFitness(accuracy, costUsd, latencyMs)

      await this.prisma.benchmarkResult.create({
        data: {
          caseId:     c.id,
          strategyId: opts.strategyId,
          accuracy,
          costUsd,
          latencyMs,
          fitness,
          output,
        },
      })

      results.push({ caseId: c.id, fitness, accuracy })
      totalFitness  += fitness
      totalAccuracy += accuracy
      totalCost     += costUsd
      totalLatency  += latencyMs
    }

    const n = cases.length
    return {
      strategyId:   opts.strategyId,
      total:        n,
      avgFitness:   totalFitness  / n,
      avgAccuracy:  totalAccuracy / n,
      avgCostUsd:   totalCost     / n,
      avgLatencyMs: Math.round(totalLatency / n),
      results,
    }
  }

  async getGoldenSet(taskType?: string) {
    return this.prisma.benchmarkCase.findMany({
      where: { approved: true, ...(taskType ? { taskType } : {}) },
      orderBy: { createdAt: 'desc' },
    })
  }

  async listCases(opts: { taskType?: string; approvedOnly?: boolean; limit?: number }) {
    return this.prisma.benchmarkCase.findMany({
      where: {
        ...(opts.taskType    ? { taskType: opts.taskType } : {}),
        ...(opts.approvedOnly ? { approved: true }          : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: opts.limit ?? 50,
    })
  }

  async createCase(dto: { taskType: string; input: string; expected: string; projectId?: string; approved?: boolean }) {
    return this.prisma.benchmarkCase.create({
      data: {
        taskType:  dto.taskType,
        input:     dto.input,
        expected:  dto.expected,
        source:    'manual',
        projectId: dto.projectId ?? null,
        approved:  dto.approved ?? true,
      },
    })
  }

  async approveCase(id: string) {
    return this.prisma.benchmarkCase.update({ where: { id }, data: { approved: true } })
  }

  async getStrategyHistory(strategyId: string) {
    const results = await this.prisma.benchmarkResult.findMany({
      where:   { strategyId },
      orderBy: { evaluatedAt: 'desc' },
      take: 100,
    })
    if (results.length === 0) return { strategyId, total: 0, avgFitness: 0, results: [] }
    const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length
    return {
      strategyId,
      total:      results.length,
      avgFitness: avg(results.map((r) => r.fitness)),
      results,
    }
  }

  // ── helpers ──────────────────────────────────────────────────────────────────

  private async evaluateAccuracy(input: string, expected: string, actual: string): Promise<number> {
    if (!actual) return 0

    try {
      const res = await this.llm.chat([
        {
          role: 'system',
          content: 'You are an evaluator. Given INPUT, EXPECTED and ACTUAL output, return ONLY a JSON object {"score": <float 0-1>} where 1 = perfect match and 0 = completely wrong. No explanation.',
        },
        {
          role: 'user',
          content: `INPUT:\n${input.slice(0, 500)}\n\nEXPECTED:\n${expected.slice(0, 500)}\n\nACTUAL:\n${actual.slice(0, 500)}`,
        },
      ], { model: 'gpt-4o-mini', temperature: 0, maxTokens: 64 })

      const text  = res.content.replace(/```json|```/g, '').trim()
      const match = text.match(/"score"\s*:\s*([\d.]+)/)
      return match ? Math.min(1, Math.max(0, parseFloat(match[1]))) : 0.5
    } catch {
      return 0.5
    }
  }

  private calcFitness(accuracy: number, costUsd: number, latencyMs: number): number {
    const costNorm    = Math.min(1, costUsd / 0.01)      // normaliza até $0.01/call
    const latencyNorm = Math.min(1, latencyMs / 10000)   // normaliza até 10s
    return accuracy * 0.7 + (1 - costNorm) * 0.15 + (1 - latencyNorm) * 0.15
  }
}
