import { BadRequestException, Injectable, Logger } from '@nestjs/common'
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
  /** Casos que produziram resultado — não é o total de casos varridos (ver `skipped`). */
  total:      number
  avgFitness: number
  avgAccuracy: number
  avgCostUsd:  number
  avgLatencyMs: number
  /** Casos descartados por falha de LLM — chamada que não aconteceu não vira medição. */
  skipped:    number
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
      return { strategyId: opts.strategyId, total: 0, avgFitness: 0, avgAccuracy: 0, avgCostUsd: 0, avgLatencyMs: 0, skipped: 0, results: [] }
    }

    const systemPrompt = await this.resolveSystemPrompt(opts)
    const results: BenchmarkRunResult['results'] = []
    let totalFitness = 0, totalAccuracy = 0, totalCost = 0, totalLatency = 0

    let skipped = 0

    for (const c of cases) {
      let output = ''
      let tokensUsed = 0
      let latencyMs = 0

      try {
        const res = await this.llm.chat([
          { role: 'system', content: systemPrompt },
          { role: 'user',   content: c.input },
          // Lote longo em free tier: vale esperar mais que o padrão em vez de
          // desistir do caso. É job de fundo, ninguém está bloqueado esperando.
          // projectId vem do caso: uma rodada pode varrer casos de projetos
          // diferentes, e agregar o custo no projeto do orquestrador atribuiria
          // gasto a quem não gastou.
        ], { model: opts.model ?? 'gpt-4o-mini', temperature: 0, maxRetries: 6, caller: 'benchmark:geracao', projectId: c.projectId ?? undefined })
        output     = res.content
        tokensUsed = res.tokensUsed
        // durationMs, não tempo de parede: a espera do retry não é lentidão do modelo.
        latencyMs  = res.durationMs
      } catch (e) {
        // Chamada que não aconteceu não é medição de qualidade. Antes o caso era
        // gravado com output vazio → accuracy 0 → fitness ~0.29, indistinguível de
        // um prompt ruim. Pior: o QA Scientist coleta fitness < 0.5 como sinal e
        // geraria hipótese de "qualidade de prompt" para uma queda de LiteLLM.
        // Aconteceu de verdade em 2026-08-07: 46 resultados falsos gravados numa
        // rodada em que o Groq estourou o TPM e o fallback Claude estava sem crédito.
        this.logger.warn(`LLM call failed for case ${c.id} — resultado NÃO gravado: ${e}`)
        skipped++
        continue
      }

      const accuracy = await this.evaluateAccuracy(c.input, c.expected, output, c.projectId ?? undefined)
      if (accuracy === null) {
        // A geração funcionou, mas o avaliador não conseguiu julgar. Gravar assim
        // seria inventar uma nota para uma resposta que ninguém avaliou.
        this.logger.warn(`Avaliação indisponível para o caso ${c.id} — resultado NÃO gravado`)
        skipped++
        continue
      }

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

    const n = results.length
    if (skipped > 0) {
      this.logger.warn(`Benchmark ${opts.strategyId}: ${skipped}/${cases.length} casos sem resultado (LLM indisponível)`)
    }
    if (n === 0) {
      return { strategyId: opts.strategyId, total: 0, avgFitness: 0, avgAccuracy: 0, avgCostUsd: 0, avgLatencyMs: 0, skipped, results: [] }
    }

    const avgFitness = totalFitness / n

    // Persistir aqui, na origem da medição, e não em cada orquestrador.
    // evaluatePopulation e runExperiment faziam isso cada um por conta própria, e
    // quem chamava a rota direto não persistia nada: em 2026-08-13 quatro
    // estratégias recém-medidas ficaram com fitnessScore null, invisíveis para o
    // getActiveStrategy — que ordena justamente por esse campo.
    // updateMany porque strategyId é id livre: rodadas ad-hoc como
    // "summarize-ptbr-v1" não têm registro em Strategy, e aí atualiza 0 linhas.
    await this.prisma.strategy
      .updateMany({ where: { id: opts.strategyId }, data: { fitnessScore: avgFitness } })
      .catch((e) => this.logger.warn(`Falha ao gravar fitness em ${opts.strategyId}: ${e}`))

    return {
      strategyId:   opts.strategyId,
      total:        n,
      avgFitness,
      avgAccuracy:  totalAccuracy / n,
      avgCostUsd:   totalCost     / n,
      avgLatencyMs: Math.round(totalLatency / n),
      skipped,
      results,
    }
  }

  /**
   * O prompt é o que está sendo medido — não pode ter default silencioso.
   *
   * Havia um: `'You are a helpful assistant. Complete the task precisely.'`. Com ele,
   * uma rodada de `classify` (casos que esperam um rótulo como "deploy") recebia
   * redações de três parágrafos e pontuava accuracy 0.044 — número real, medição sem
   * sentido, e que ainda alimentaria o QA Scientist como "qualidade de prompt ruim"
   * de um prompt que nenhum módulo usa. Viola também a regra do CLAUDE.md de que
   * nenhum módulo usa system prompt genérico.
   *
   * Sem prompt explícito, busca o da estratégia sendo medida. Sem ela, falha — medir
   * nada é pior que não medir.
   */
  private async resolveSystemPrompt(opts: BenchmarkRunOptions): Promise<string> {
    if (opts.systemPrompt?.trim()) return opts.systemPrompt

    const strategy = await this.prisma.strategy.findUnique({
      where:  { id: opts.strategyId },
      select: { systemPrompt: true },
    }).catch(() => null)

    if (strategy?.systemPrompt?.trim()) {
      this.logger.log(`Benchmark ${opts.strategyId}: usando o systemPrompt da estratégia registrada`)
      return strategy.systemPrompt
    }

    throw new BadRequestException(
      `Benchmark exige systemPrompt: "${opts.strategyId}" não é uma estratégia registrada e nenhum prompt foi informado. ` +
      `Rodar com prompt genérico produz número real e medição sem sentido.`,
    )
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

  /**
   * @returns nota 0-1, ou `null` quando o próprio avaliador não pôde julgar.
   *
   * Antes devolvia 0.5 tanto para "não consegui parsear" quanto para "a chamada
   * falhou" — um valor plausível no meio da escala, indistinguível de uma avaliação
   * real e imune a qualquer inspeção posterior. Mesma classe do bug de gravar
   * resultado com LLM fora do ar: falha de infra virando dado.
   */
  private async evaluateAccuracy(input: string, expected: string, actual: string, projectId?: string): Promise<number | null> {
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
        // O avaliador custa tanto quanto a geração — deixá-lo fora do registro
        // subestimaria o custo real de uma rodada pela metade.
      ], { model: 'gpt-4o-mini', temperature: 0, maxTokens: 64, maxRetries: 6, caller: 'benchmark:avaliador', projectId })

      const text  = res.content.replace(/```json|```/g, '').trim()
      const match = text.match(/"score"\s*:\s*([\d.]+)/)
      if (!match) {
        this.logger.warn(`Avaliador não devolveu score parseável: ${text.slice(0, 120)}`)
        return null
      }
      return Math.min(1, Math.max(0, parseFloat(match[1])))
    } catch (e) {
      this.logger.warn(`Avaliador falhou: ${e}`)
      return null
    }
  }

  private calcFitness(accuracy: number, costUsd: number, latencyMs: number): number {
    const costNorm    = Math.min(1, costUsd / 0.01)      // normaliza até $0.01/call
    const latencyNorm = Math.min(1, latencyMs / 10000)   // normaliza até 10s
    return accuracy * 0.7 + (1 - costNorm) * 0.15 + (1 - latencyNorm) * 0.15
  }
}
