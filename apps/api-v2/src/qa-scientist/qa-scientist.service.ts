import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { PrismaV2Service } from '../core/prisma-v2.service'
import { LlmService } from '../llm/llm.service'
import { BenchmarkService } from '../benchmark/benchmark.service'
import { EvolutionaryService } from '../evolutionary/evolutionary.service'
import { ApprovalGatesService } from '../approval-gates/approval-gates.service'

interface FailureSignal {
  type:      'step_failure' | 'low_fitness' | 'trace_error'
  detail:    string
  taskType?: string
}

interface LlmAnalysis {
  title:              string
  analysis:           string
  taskType:           string | null
  isPropQualityIssue: boolean
}

@Injectable()
export class QaScientistService implements OnModuleInit, OnModuleDestroy {
  private readonly logger  = new Logger(QaScientistService.name)
  private cycleTimer: ReturnType<typeof setTimeout> | null  = null
  private cycleInterval: ReturnType<typeof setInterval> | null = null

  constructor(
    private readonly prisma:       PrismaV2Service,
    private readonly llm:          LlmService,
    private readonly benchmark:    BenchmarkService,
    private readonly evolutionary: EvolutionaryService,
    private readonly gates:        ApprovalGatesService,
  ) {}

  onModuleInit() {
    // First run 10 min after boot; then every 24h
    const WARMUP_MS   = 10 * 60 * 1000
    const INTERVAL_MS = 24 * 60 * 60 * 1000

    this.cycleTimer = setTimeout(() => {
      void this.runForAllProjects()
      this.cycleInterval = setInterval(() => void this.runForAllProjects(), INTERVAL_MS)
    }, WARMUP_MS)

    this.logger.log('QaScientistService: daily cycle scheduled (first run in 10 min)')
  }

  onModuleDestroy() {
    if (this.cycleTimer)    clearTimeout(this.cycleTimer)
    if (this.cycleInterval) clearInterval(this.cycleInterval)
  }

  // ── Public API ───────────────────────────────────────────────────────────────

  async runForAllProjects() {
    const projects = await this.prisma.projectCatalog.findMany({
      where: { archivedAt: null },
      take:  10,
    })

    if (projects.length === 0) {
      this.logger.log('QA Scientist: no projects in catalog — skipping cycle')
      return
    }

    for (const p of projects) {
      await this.dailyCycle(p.v1ProjectId).catch((e) =>
        this.logger.warn(`QA Scientist: cycle failed for ${p.v1ProjectId}: ${e}`),
      )
    }
  }

  async dailyCycle(projectId: string): Promise<{ hypothesisId: string | null; skipped: boolean; reason: string }> {
    this.logger.log(`QA Scientist: starting cycle for project ${projectId}`)

    const failures = await this.collectFailures(projectId)

    if (failures.length === 0) {
      this.logger.log(`QA Scientist: no failures for ${projectId} — skipping`)
      return { hypothesisId: null, skipped: true, reason: 'no_failures' }
    }

    const analysis = await this.analyzeWithLlm(failures)
    if (!analysis) {
      return { hypothesisId: null, skipped: true, reason: 'llm_analysis_empty' }
    }

    const hypothesis = await this.prisma.hypothesis.create({
      data: {
        projectId,
        taskType:     analysis.taskType ?? null,
        title:        analysis.title,
        analysis:     analysis.analysis,
        failureCount: failures.length,
        status:       'active',
      },
    })

    this.logger.log(`QA Scientist: hypothesis ${hypothesis.id.slice(0, 8)} — "${hypothesis.title}"`)

    if (analysis.isPropQualityIssue && analysis.taskType) {
      await this.runExperiment(hypothesis.id, analysis.taskType, projectId)
    }

    return { hypothesisId: hypothesis.id, skipped: false, reason: 'cycle_complete' }
  }

  async listHypotheses(opts: { projectId?: string; status?: string; limit?: number }) {
    return this.prisma.hypothesis.findMany({
      where: {
        ...(opts.projectId ? { projectId: opts.projectId } : {}),
        ...(opts.status    ? { status:    opts.status    } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take:    opts.limit ?? 20,
    })
  }

  async getHypothesis(id: string) {
    return this.prisma.hypothesis.findUniqueOrThrow({ where: { id } })
  }

  async rejectHypothesis(id: string) {
    return this.prisma.hypothesis.update({
      where: { id },
      data:  { status: 'rejected', resolvedAt: new Date() },
    })
  }

  // ── Failure collection ───────────────────────────────────────────────────────

  private async collectFailures(projectId: string): Promise<FailureSignal[]> {
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    const signals: FailureSignal[] = []

    // 1. Failed / skipped mission steps
    const failedSteps = await this.prisma.missionStep.findMany({
      where: {
        status:    { in: ['failed', 'skipped'] },
        updatedAt: { gte: since },
        mission:   { projectId },
      },
      include: { mission: { select: { objective: true } } },
      take: 20,
    })

    for (const step of failedSteps) {
      const outputStr = typeof step.output === 'string'
        ? step.output
        : JSON.stringify(step.output ?? '')
      signals.push({
        type:     'step_failure',
        detail:   `Step "${step.title}" (executor:${step.executor}, status:${step.status}). Output: ${outputStr.slice(0, 200)}`,
        taskType: this.inferTaskType(step.title),
      })
    }

    // 2. Low-fitness benchmark results (fitness < 0.5)
    const lowFitness = await this.prisma.benchmarkResult.findMany({
      where:   { fitness: { lt: 0.5 }, evaluatedAt: { gte: since } },
      include: { case: { select: { taskType: true } } },
      take:    10,
    })

    for (const r of lowFitness) {
      signals.push({
        type:     'low_fitness',
        detail:   `BenchmarkResult fitness=${r.fitness.toFixed(3)} para task_type=${r.case.taskType} (strategy ${r.strategyId.slice(0, 8)})`,
        taskType: r.case.taskType,
      })
    }

    // 3. Error trace spans
    const errorSpans = await this.prisma.traceSpan.findMany({
      where:   { status: 'error', startedAt: { gte: since } },
      take:    10,
    })

    for (const span of errorSpans) {
      const attrs = span.attributes as Record<string, unknown>
      signals.push({
        type:     'trace_error',
        detail:   `TraceSpan ${span.operation} errored: ${JSON.stringify(attrs).slice(0, 200)}`,
        taskType: span.operation,
      })
    }

    return signals
  }

  // ── LLM analysis ────────────────────────────────────────────────────────────

  private async analyzeWithLlm(failures: FailureSignal[]): Promise<LlmAnalysis | null> {
    if (failures.length === 0) return null

    const failureText = failures.map((f) => `[${f.type}] ${f.detail}`).join('\n')

    const res = await this.llm.chat(
      [
        {
          role:    'system',
          content: `Você é um AI Scientist que analisa falhas e formula hipóteses.
Retorne SOMENTE JSON válido, sem markdown, sem code fences:
{"title":"<hipótese curta em PT-BR max 80 chars>","analysis":"<causa raiz + padrão + impacto em uma frase por tópico, max 300 chars>","taskType":"classify|summarize|context_synthesis|null","isPropQualityIssue":false}
isPropQualityIssue=true apenas para qualidade de prompt (baixo fitness). false para infra/config/dependência.`,
        },
        {
          role:    'user',
          content: `SINAIS DE FALHA (últimos 7 dias):\n${failureText}`,
        },
      ],
      { model: 'gpt-4o-mini', temperature: 0.1, maxTokens: 2048 },
    )

    try {
      // Extract JSON object regardless of surrounding markdown/text
      const jsonMatch = res.content.match(/\{[\s\S]*\}/)
      const text      = jsonMatch ? jsonMatch[0] : res.content.replace(/```json|```/g, '').trim()
      const parsed    = JSON.parse(text) as LlmAnalysis
      return parsed
    } catch {
      this.logger.warn('QA Scientist: analyzeWithLlm — failed to parse JSON, using plain text fallback')
      return {
        title:              'Análise de falhas recentes',
        analysis:           res.content.slice(0, 500),
        taskType:           null,
        isPropQualityIssue: false,
      }
    }
  }

  // ── Experiment ───────────────────────────────────────────────────────────────

  private async runExperiment(hypothesisId: string, taskType: string, projectId: string) {
    const caseCount = await this.prisma.benchmarkCase.count({ where: { taskType, approved: true } })
    if (caseCount === 0) {
      this.logger.log(`QA Scientist: no benchmark cases for task_type=${taskType} — experiment skipped`)
      return
    }

    await this.prisma.hypothesis.update({ where: { id: hypothesisId }, data: { status: 'experimenting' } })

    const baseline        = await this.evolutionary.getActiveStrategy(taskType)
    const baselineFitness = baseline?.fitnessScore ?? 0

    // Mutate existing strategy or seed a new one
    let strategyId: string
    if (baseline) {
      const mutated = await this.evolutionary.mutate(baseline.id)
      strategyId = mutated.id
    } else {
      const seeded = await this.evolutionary.seed({
        taskType,
        systemPrompt: `Você é um assistente especializado em ${taskType}. Responda de forma precisa, concisa e estruturada em PT-BR.`,
        notes:        `QA Scientist seed — hipótese ${hypothesisId.slice(0, 8)}`,
      })
      strategyId = seeded.id
    }

    const result = await this.benchmark
      .runForStrategy({ strategyId, taskType, goldenOnly: true, limit: 5 })
      .catch(() => null)

    const currentFitness = result?.avgFitness ?? 0
    const improvement    = currentFitness - baselineFitness

    const report = this.buildReport({ hypothesisId, taskType, baselineFitness, currentFitness, result })

    let gateId: string | null = null
    if (improvement > 0.02) {
      const gate = await this.gates.create({
        projectId,
        type:        'strategy_promotion',
        description: `QA Scientist — promover ${strategyId.slice(0, 8)} para ${taskType} (Δfitness ${improvement > 0 ? '+' : ''}${improvement.toFixed(3)})`,
        context:     { hypothesisId, strategyId, taskType, currentFitness, baselineFitness, improvement },
        riskLevel:   'medium',
      })
      gateId = gate.id
    }

    await this.prisma.hypothesis.update({
      where: { id: hypothesisId },
      data: {
        status:         gateId ? 'promoted' : 'active',
        strategyId,
        gateId:         gateId ?? null,
        baselineFitness,
        currentFitness,
        report,
        resolvedAt:     new Date(),
      },
    })

    this.logger.log(
      `QA Scientist: experiment done for ${hypothesisId.slice(0, 8)} — Δfitness=${improvement.toFixed(3)}${gateId ? ' gate=' + gateId.slice(0, 8) : ''}`,
    )
  }

  private buildReport(opts: {
    hypothesisId:    string
    taskType:        string
    baselineFitness: number
    currentFitness:  number
    result:          { total: number; avgCostUsd: number; avgLatencyMs: number } | null
  }): string {
    const { hypothesisId, taskType, baselineFitness, currentFitness, result } = opts
    const delta = currentFitness - baselineFitness
    const conclusion = delta > 0.02
      ? '✅ Melhoria significativa (Δ > 0.02). Gate de promoção criado.'
      : delta > 0
        ? '⚠️ Melhoria marginal (Δ < 0.02). Sem promoção automática.'
        : '❌ Sem melhoria. Candidato não recomendado.'

    return [
      `# Relatório de Experimento — ${hypothesisId.slice(0, 8)}`,
      '',
      `**Task type:** \`${taskType}\``,
      `**Fitness baseline:** ${baselineFitness.toFixed(3)}`,
      `**Fitness candidato:** ${currentFitness.toFixed(3)}`,
      `**Δ fitness:** ${delta > 0 ? '+' : ''}${delta.toFixed(3)}`,
      `**Casos avaliados:** ${result?.total ?? 0}`,
      `**Custo médio:** $${result?.avgCostUsd?.toFixed(5) ?? '—'}`,
      `**Latência média:** ${result?.avgLatencyMs ?? '—'}ms`,
      '',
      `## Conclusão`,
      conclusion,
    ].join('\n')
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  private inferTaskType(stepTitle: string): string | undefined {
    const lower = stepTitle.toLowerCase()
    if (/classif|categoriz/.test(lower))       return 'classify'
    if (/sumar|resumo|síntese|síntese/.test(lower)) return 'summarize'
    if (/context|projeto|estado/.test(lower))  return 'context_synthesis'
    return undefined
  }
}
