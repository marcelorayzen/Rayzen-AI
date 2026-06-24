import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { PrismaV2Service } from '../core/prisma-v2.service'
import { LlmService } from '../llm/llm.service'
import { AiRouterService } from '../ai-router/ai-router.service'
import { ApprovalGatesService } from '../approval-gates/approval-gates.service'
import { BenchmarkService } from '../benchmark/benchmark.service'

export interface StrategyRecord {
  id:           string
  taskType:     string
  generation:   number
  systemPrompt: string
  tier:         number
  temperature:  number
  fitnessScore: number | null
  status:       string
  parentIds:    string[]
  notes:        string | null
  promotedAt:   Date | null
  retiredAt:    Date | null
  createdAt:    Date
}

@Injectable()
export class EvolutionaryService implements OnModuleInit {
  private readonly logger = new Logger(EvolutionaryService.name)

  constructor(
    private readonly prisma:     PrismaV2Service,
    private readonly llm:        LlmService,
    private readonly aiRouter:   AiRouterService,
    private readonly gates:      ApprovalGatesService,
    private readonly benchmark:  BenchmarkService,
  ) {}

  // Wires EvolutionaryService into AiRouterService (lazy to avoid circular dep)
  onModuleInit() {
    this.aiRouter.setEvolutionary(this)
    this.logger.log('EvolutionaryService wired into AiRouterService')
  }

  // ── Strategy lookup (used by AiRouterService) ─────────────────────────────

  async getActiveStrategy(taskType: string): Promise<StrategyRecord | null> {
    const strategy = await this.prisma.strategy.findFirst({
      where:   { taskType, status: 'active' },
      orderBy: { fitnessScore: 'desc' },
    })
    return strategy as StrategyRecord | null
  }

  async getPopulation(taskType: string, n = 10): Promise<StrategyRecord[]> {
    const results = await this.prisma.strategy.findMany({
      where:   { taskType, status: { not: 'retired' } },
      orderBy: [{ fitnessScore: 'desc' }, { createdAt: 'desc' }],
      take: n,
    })
    return results as StrategyRecord[]
  }

  async listStrategies(opts: { taskType?: string; status?: string; limit?: number }) {
    return this.prisma.strategy.findMany({
      where: {
        ...(opts.taskType ? { taskType: opts.taskType } : {}),
        ...(opts.status   ? { status:   opts.status   } : {}),
      },
      orderBy: [{ fitnessScore: 'desc' }, { createdAt: 'desc' }],
      take: opts.limit ?? 50,
    })
  }

  // ── Seed an initial candidate strategy manually ───────────────────────────

  async seed(dto: {
    taskType:     string
    systemPrompt: string
    tier?:        number
    temperature?: number
    notes?:       string
  }): Promise<StrategyRecord> {
    const strategy = await this.prisma.strategy.create({
      data: {
        taskType:     dto.taskType,
        systemPrompt: dto.systemPrompt,
        tier:         dto.tier ?? 3,
        temperature:  dto.temperature ?? 0.2,
        notes:        dto.notes ?? null,
        status:       'candidate',
        parentIds:    [],
      },
    })
    return strategy as StrategyRecord
  }

  // ── Mutation via LLM ──────────────────────────────────────────────────────

  async mutate(parentId: string): Promise<StrategyRecord> {
    const parent = await this.prisma.strategy.findUniqueOrThrow({ where: { id: parentId } })

    const res = await this.llm.chat(
      [
        {
          role: 'system',
          content: `You are an AI prompt engineer. Your task is to create an improved variation of a system prompt.
Rules:
- Keep the same intent and task type
- Change at most 30% of the content — small, targeted improvements
- Return ONLY the new system prompt text (no JSON, no explanation, no markdown)`,
        },
        {
          role: 'user',
          content: `TASK TYPE: ${parent.taskType}\n\nORIGINAL SYSTEM PROMPT:\n${parent.systemPrompt}\n\nGenerate an improved variation:`,
        },
      ],
      { model: 'gpt-4o-mini', temperature: 0.7, maxTokens: 1024 },
    )

    const mutated = await this.prisma.strategy.create({
      data: {
        taskType:     parent.taskType,
        systemPrompt: res.content.trim(),
        tier:         parent.tier,
        temperature:  parent.temperature,
        generation:   parent.generation + 1,
        status:       'candidate',
        parentIds:    [...parent.parentIds, parent.id],
        notes:        `Mutated from ${parent.id} (gen ${parent.generation})`,
      },
    })
    this.logger.log(`Mutated strategy ${parent.id} → ${mutated.id} (gen ${mutated.generation})`)
    return mutated as StrategyRecord
  }

  // ── Evolve: benchmark candidates → pick best → mutate → propose gate ──────

  async evolve(taskType: string, projectId: string): Promise<{
    evaluated:  number
    bestFitness: number
    candidate:  StrategyRecord
    gateId:     string | null
  }> {
    const unevaluated = await this.prisma.strategy.findMany({
      where: { taskType, status: 'candidate', fitnessScore: null },
      take: 5,
    })

    let evaluated = 0
    for (const s of unevaluated) {
      const result = await this.benchmark.runForStrategy({
        strategyId:   s.id,
        taskType,
        goldenOnly:   true,
        limit:        10,
        systemPrompt: s.systemPrompt,
        model:        this.tierToModel(s.tier),
      }).catch(() => null)

      if (result && result.total > 0) {
        await this.prisma.strategy.update({
          where: { id: s.id },
          data:  { fitnessScore: result.avgFitness },
        })
        evaluated++
      }
    }

    // Pick best unevaluated candidate (now evaluated) or existing candidate
    const best = await this.prisma.strategy.findFirst({
      where:   { taskType, status: 'candidate', fitnessScore: { not: null } },
      orderBy: { fitnessScore: 'desc' },
    })

    if (!best) {
      return { evaluated, bestFitness: 0, candidate: unevaluated[0] as StrategyRecord, gateId: null }
    }

    // Compare vs current active strategy
    const active = await this.getActiveStrategy(taskType)
    const currentFitness = active?.fitnessScore ?? 0
    const improvement    = (best.fitnessScore ?? 0) - currentFitness

    let gateId: string | null = null
    if (improvement > 0.02) {
      const gate = await this.gates.create({
        projectId,
        type:        'strategy_promotion' as never,
        description: `Promover estratégia ${best.id.slice(0, 8)} para ${taskType} — fitness ${(best.fitnessScore ?? 0).toFixed(3)} vs ${currentFitness.toFixed(3)} atual (Δ${improvement > 0 ? '+' : ''}${improvement.toFixed(3)})`,
        context:     { strategyId: best.id, taskType, fitnessScore: best.fitnessScore, currentFitness, improvement },
        riskLevel:   'medium',
      })
      gateId = gate.id
      this.logger.log(`Proposta de promoção criada: gate ${gate.id} para estratégia ${best.id}`)
    } else {
      this.logger.log(`Melhor candidato fitness=${(best.fitnessScore ?? 0).toFixed(3)} não supera threshold (Δ=${improvement.toFixed(3)}) — sem promoção`)
    }

    // Mutate best to keep population evolving
    void this.mutate(best.id).catch((e) => this.logger.warn(`mutate failed: ${e}`))

    return {
      evaluated,
      bestFitness: best.fitnessScore ?? 0,
      candidate:   best as StrategyRecord,
      gateId,
    }
  }

  // ── Promotion / retirement ────────────────────────────────────────────────

  async promote(strategyId: string): Promise<StrategyRecord> {
    const strategy = await this.prisma.strategy.findUniqueOrThrow({ where: { id: strategyId } })

    // Retire current active strategies for same taskType
    await this.prisma.strategy.updateMany({
      where: { taskType: strategy.taskType, status: 'active' },
      data:  { status: 'retired', retiredAt: new Date() },
    })

    const promoted = await this.prisma.strategy.update({
      where: { id: strategyId },
      data:  { status: 'active', promotedAt: new Date() },
    })
    this.logger.log(`Estratégia ${strategyId} promovida para active (taskType=${strategy.taskType})`)
    return promoted as StrategyRecord
  }

  async retire(strategyId: string): Promise<StrategyRecord> {
    const retired = await this.prisma.strategy.update({
      where: { id: strategyId },
      data:  { status: 'retired', retiredAt: new Date() },
    })
    return retired as StrategyRecord
  }

  // ── helpers ───────────────────────────────────────────────────────────────

  private tierToModel(tier: number): string {
    const map: Record<number, string> = { 2: 'gpt-4o-mini', 3: 'gpt-4o', 4: 'gpt-4o-premium' }
    return map[tier] ?? 'gpt-4o-mini'
  }
}
