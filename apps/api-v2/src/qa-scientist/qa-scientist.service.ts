import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { PrismaV2Service } from '../core/prisma-v2.service'
import { LlmService } from '../llm/llm.service'
import { BenchmarkService } from '../benchmark/benchmark.service'
import { TASK_TYPES } from '../benchmark/task-types.const'
import { EvolutionaryService } from '../evolutionary/evolutionary.service'
import { ApprovalGatesService } from '../approval-gates/approval-gates.service'
import { SystemStatusService } from '../system-status/system-status.service'

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
    private readonly system:       SystemStatusService,
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
    // `beat` em `finally` — ver system-status.service.ts.
    let ok = false
    let erro: string | undefined
    let ciclos    = 0
    let semSinal  = 0
    let hipoteses = 0

    try {
    const projects = await this.prisma.projectCatalog.findMany({
      where: { archivedAt: null },
      take:  10,
    })

    if (projects.length === 0) {
      this.logger.log('QA Scientist: no projects in catalog — skipping cycle')
      // `ok` antes do return: rodar e não ter o que fazer é sucesso. Sem isto o
      // `finally` reportaria "falhando" para um ciclo perfeitamente saudável —
      // a mesma ambiguidade que este batimento existe para eliminar.
      ok = true
      return
    }

    for (const p of projects) {
      const r = await this.dailyCycle(p.v1ProjectId).catch((e) => {
        this.logger.warn(`QA Scientist: cycle failed for ${p.v1ProjectId}: ${e}`)
        return null
      })
      ciclos++
      if (r?.hypothesisId)              hipoteses++
      else if (r?.reason === 'no_failures') semSinal++
    }
      ok = true
    } catch (e) {
      erro = e instanceof Error ? e.message : String(e)
      this.logger.warn(`QA Scientist: ciclo falhou: ${erro}`)
    } finally {
      // `ciclos` sozinho não distinguia "varreu e não havia o que analisar" de "varreu
      // sobre fontes que morreram". Medido em 06/09: o batimento dizia `{ciclos: 10}` e
      // `ok: true` todo dia desde 24/08, enquanto as TRÊS fontes de `collectFailures`
      // estavam vazias — `mission_steps` porque o executor está congelado por decisão de
      // produto, `benchmark_results` porque só este ciclo os produz (fome circular), e
      // `trace_spans` que nunca teve uma linha sequer. Nenhum alarme: o ciclo estava vivo,
      // pontual e sem nada para fazer, e é exatamente assim que ele estaria se o sensor
      // tivesse sido desligado.
      //
      // Mesmo princípio do batimento ser separado da saída (system-status.service.ts): a
      // diferença é que ali a pergunta era "morreu ou está quieto?", e aqui é "está quieto
      // porque tudo vai bem, ou porque ninguém liga mais na entrada?".
      await this.system.beat('qa-scientist', { ok, erro, detalhe: { ciclos, semSinal, hipoteses } })
    }
  }

  async dailyCycle(projectId: string): Promise<{ hypothesisId: string | null; skipped: boolean; reason: string }> {
    this.logger.log(`QA Scientist: starting cycle for project ${projectId}`)

    const failures = await this.collectFailures(projectId)

    if (failures.length === 0) {
      this.logger.log(`QA Scientist: no failures for ${projectId} — skipping`)
      return { hypothesisId: null, skipped: true, reason: 'no_failures' }
    }

    const analysis = await this.analyzeWithLlm(failures, projectId)
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
      // Falhas jarvis:* por agent desktop offline não são qualidade de prompt —
      // filtrar para não acumular hipóteses duplicadas de infra no ciclo seguinte.
      const out = step.output as Record<string, unknown> | null
      const abort = out?.['abortReason'] as string | undefined
      if (abort?.startsWith('skill_repeated_failure:jarvis:') ||
          abort?.startsWith('skill_repeated_exception:jarvis:')) continue

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
    // Cada projeto vê SÓ os próprios casos. A versão anterior também aceitava
    // `projectId: null` como "sinal legítimo pra qualquer projeto" — o que na
    // prática significava que 46 casos-semente sem dono, com 36 resultados de
    // fitness baixo, contariam para todo projeto do catálogo. Registrar 7 projetos
    // teria gerado 7 hipóteses idênticas sobre o mesmo fitness.
    // Caso órfão não some em silêncio: o invariante `benchmark_case_tem_dono`
    // acusa quem ficou sem projeto.
    const lowFitness = await this.prisma.benchmarkResult.findMany({
      where: {
        fitness:     { lt: 0.5 },
        evaluatedAt: { gte: since },
        case:        { projectId },
      },
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

  private async analyzeWithLlm(failures: FailureSignal[], projectId: string): Promise<LlmAnalysis | null> {
    if (failures.length === 0) return null

    const failureText = failures.map((f) => `[${f.type}] ${f.detail}`).join('\n')

    const res = await this.llm.chat(
      [
        {
          role:    'system',
          // O placeholder de taskType era "classify|summarize|context_synthesis|null"
          // escrito dentro do próprio valor JSON — e o modelo copiou a string inteira
          // como resposta, gravando uma hipótese com esse taskType literal no banco.
          // Enumerar fora do valor evita convidar a cópia.
          content: `Você é um AI Scientist que analisa falhas e formula hipóteses.
Retorne SOMENTE JSON válido, sem markdown, sem code fences:
{"title":"<hipótese curta em PT-BR max 80 chars>","analysis":"<causa raiz + padrão + impacto em uma frase por tópico, max 300 chars>","taskType":<ver abaixo>,"isPropQualityIssue":false}
taskType: escolha UM valor entre ${TASK_TYPES.map((t) => `"${t}"`).join(', ')}, ou null se a falha não for específica de um deles. Nunca devolva mais de um.
isPropQualityIssue=true apenas para qualidade de prompt (baixo fitness). false para infra/config/dependência.`,
        },
        {
          role:    'user',
          content: `SINAIS DE FALHA (últimos 7 dias):\n${failureText}`,
        },
      ],
      { model: 'gpt-4o-mini', temperature: 0.1, maxTokens: 2048, caller: 'qa-scientist:analyze', projectId },
    )

    try {
      // Find the first balanced JSON object in the response
      const text = this.extractFirstJson(res.content)
      if (!text) throw new Error('no JSON found')
      return this.normalizeAnalysis(JSON.parse(text) as Record<string, unknown>, res.content)
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

  /** taskTypes que o experimento sabe rodar — qualquer outra coisa vira null. */
  private static readonly KNOWN_TASK_TYPES: readonly string[] = TASK_TYPES

  /** Fitness mínimo para propor promoção. Mesmo 0.6 que o roadmap usa como qualidade aceitável. */
  private static readonly MIN_PROMOVIVEL = 0.6

  /**
   * Melhor fitness já MEDIDO para o taskType, usado como baseline quando não há
   * estratégia ativa. Sem isso o baseline era 0 e toda rodada parecia um salto
   * enorme — a comparação passa a ser contra o melhor que já se conseguiu, que é
   * a pergunta certa: "essa mutação é melhor do que qualquer coisa já testada?".
   */
  private async melhorFitnessMedido(taskType: string): Promise<number> {
    const agg = await this.prisma.benchmarkResult.aggregate({
      _max:  { fitness: true },
      where: { case: { taskType } },
    }).catch(() => null)
    return agg?._max.fitness ?? 0
  }

  /**
   * A saída do LLM só vira Hypothesis depois de conferida.
   *
   * Sem isso, o modelo devolveu literalmente a string do placeholder do schema
   * ("classify|summarize|context_synthesis|null") como taskType e ela foi gravada
   * assim no banco. Um taskType inválido não quebra nada visivelmente — só faz
   * runExperiment não encontrar caso nenhum e o ciclo desistir em silêncio.
   */
  private normalizeAnalysis(raw: Record<string, unknown>, fallbackText: string): LlmAnalysis {
    const str = (v: unknown, max: number, fallback: string): string =>
      typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : fallback

    const declared = typeof raw.taskType === 'string' ? raw.taskType.trim() : null
    const taskType = declared && QaScientistService.KNOWN_TASK_TYPES.includes(declared) ? declared : null
    if (declared && !taskType) {
      this.logger.warn(`QA Scientist: taskType "${declared}" não é conhecido — gravando null`)
    }

    return {
      title:              str(raw.title, 80, 'Análise de falhas recentes'),
      analysis:           str(raw.analysis, 500, fallbackText.slice(0, 500)),
      taskType,
      isPropQualityIssue: raw.isPropQualityIssue === true,
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
    const baselineFitness = baseline?.fitnessScore ?? await this.melhorFitnessMedido(taskType)

    // Mutate existing strategy or seed a new one
    let strategyId: string
    let systemPrompt: string
    if (baseline) {
      const mutated = await this.evolutionary.mutate(baseline.id)
      strategyId   = mutated.id
      systemPrompt = mutated.systemPrompt
    } else {
      const seeded = await this.evolutionary.seed({
        taskType,
        systemPrompt: `Você é um assistente especializado em ${taskType}. Responda de forma precisa, concisa e estruturada em PT-BR.`,
        notes:        `QA Scientist seed — hipótese ${hypothesisId.slice(0, 8)}`,
      })
      strategyId   = seeded.id
      systemPrompt = seeded.systemPrompt
    }

    // O systemPrompt da estratégia mutada TEM que ir junto. Sem ele, runForStrategy
    // caía num prompt genérico: o experimento gravava o resultado sob o id da mutação
    // mas media outra coisa, e a decisão de promover comparava baselineFitness com um
    // número que não tinha relação nenhuma com a mutação. O loop evolutivo inteiro
    // estava selecionando ruído.
    const result = await this.benchmark
      .runForStrategy({ strategyId, taskType, goldenOnly: true, limit: 5, systemPrompt })
      .catch(() => null)

    const currentFitness = result?.avgFitness ?? 0
    const improvement    = currentFitness - baselineFitness

    // O fitness é persistido por runForStrategy, na origem da medição — este
    // caminho tinha cópia própria, e quem chamava a rota direto não tinha nenhuma.
    const report = this.buildReport({ hypothesisId, taskType, baselineFitness, currentFitness, result })

    // Promover exige melhora real E qualidade mínima absoluta. Só o delta não basta:
    // sem estratégia ativa o baseline era 0, então qualquer resultado virava
    // "+0.46" e abria gate — inclusive rodadas piores que as anteriores. Em
    // produção isso gerou 6 gates de promoção, e os que abriram foram justamente
    // os piores resultados. MIN_PROMOVIVEL é o mesmo 0.6 que o roadmap usa como
    // critério de qualidade aceitável.
    let gateId: string | null = null
    if (improvement > 0.02 && currentFitness >= QaScientistService.MIN_PROMOVIVEL) {
      const gate = await this.gates.create({
        projectId,
        type:        'strategy_promotion',
        description: `QA Scientist — promover ${strategyId.slice(0, 8)} para ${taskType} (Δfitness ${improvement > 0 ? '+' : ''}${improvement.toFixed(3)})`,
        context:     { hypothesisId, strategyId, taskType, currentFitness, baselineFitness, improvement },
        // 'high' = 7 dias, não os 30 min de 'medium'. Promover troca o system prompt
        // que o app inteiro passa a usar naquele taskType: é decisão deliberada, sem
        // urgência nenhuma. Com 30 min o gate era criado e AUTO-REJEITADO antes de
        // qualquer humano abrir a tela — 5 dos 6 gates de promoção expiraram assim,
        // e nenhum chegou a ser visto.
        riskLevel:   'high',
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

  // Extrai o primeiro objeto JSON balanceado de uma string (ignora texto ao redor)
  private extractFirstJson(text: string): string | null {
    const start = text.indexOf('{')
    if (start === -1) return null
    let depth = 0
    for (let i = start; i < text.length; i++) {
      if (text[i] === '{') depth++
      else if (text[i] === '}') {
        depth--
        if (depth === 0) return text.slice(start, i + 1)
      }
    }
    return null
  }

  private inferTaskType(stepTitle: string): string | undefined {
    const lower = stepTitle.toLowerCase()
    if (/classif|categoriz/.test(lower))       return 'classify'
    if (/sumar|resumo|síntese|síntese/.test(lower)) return 'summarize'
    if (/context|projeto|estado/.test(lower))  return 'context_synthesis'
    return undefined
  }
}
