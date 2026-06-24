import { Injectable, Logger } from '@nestjs/common'

export type AITaskType =
  | 'classify' | 'summarize' | 'extract'
  | 'generate_code' | 'review' | 'implement'
  | 'analyze' | 'strategic' | 'architecture'

export interface AIToolDefinition {
  name:        string
  description: string
  parameters:  Record<string, unknown>
}

export interface AIToolCall {
  id:        string
  name:      string
  arguments: Record<string, unknown>
}

export interface AIRequest {
  /** Obrigatório se `messages` não for informado. */
  prompt?:       string
  systemPrompt?: string
  tier?:         0 | 1 | 2 | 3 | 4
  maxTier?:      0 | 1 | 2 | 3 | 4
  taskType?:     AITaskType
  projectId?:    string
  maxTokens?:    number
  /** Histórico completo de mensagens (incl. resultados de tool calls anteriores) — se omitido, usa prompt/systemPrompt como antes. */
  messages?:     Array<{ role: string; content: string; tool_call_id?: string; tool_calls?: unknown[] }>
  tools?:        AIToolDefinition[]
}

export interface AIResponse {
  content:    string
  modelUsed:  string
  tier:       number
  tokensIn:   number
  tokensOut:  number
  costUsd:    number
  durationMs: number
  retries:    number
  toolCalls?: AIToolCall[]
}

interface TierConfig {
  tier:       number
  model:      string          // LiteLLM alias
  costPer1M:  number          // USD blended
  maxTokens:  number
  taskTypes:  AITaskType[]
}

const TIERS: TierConfig[] = [
  {
    tier: 2,
    model: 'gpt-4o-mini',
    costPer1M: 0.10,
    maxTokens: 4096,
    taskTypes: ['classify', 'summarize', 'extract'],
  },
  {
    tier: 3,
    model: 'gpt-4o',
    costPer1M: 0.70,
    maxTokens: 8192,
    taskTypes: ['generate_code', 'review', 'implement', 'analyze'],
  },
  {
    tier: 4,
    model: 'gpt-4o-premium',
    costPer1M: 9.00,
    maxTokens: 8192,
    taskTypes: ['strategic', 'architecture'],
  },
]

// Which tier each task type defaults to
const TASK_DEFAULT_TIER: Record<AITaskType, number> = {
  classify:      2,
  summarize:     2,
  extract:       2,
  generate_code: 3,
  review:        3,
  implement:     3,
  analyze:       3,
  strategic:     4,
  architecture:  4,
}

@Injectable()
export class AiRouterService {
  private readonly logger = new Logger(AiRouterService.name)
  private readonly baseUrl: string
  private readonly masterKey: string
  private costController: import('../cost-controller/cost-controller.service').CostControllerService | null = null
  private evolutionary: { getActiveStrategy: (taskType: string) => Promise<{ systemPrompt: string; tier: number } | null> } | null = null

  constructor() {
    this.baseUrl = (process.env.LITELLM_BASE_URL ?? 'http://litellm:4000/v1').replace(/\/$/, '')
    this.masterKey = process.env.LITELLM_MASTER_KEY ?? ''
  }

  // Injected lazily to avoid circular dependency
  setCostController(svc: import('../cost-controller/cost-controller.service').CostControllerService) {
    this.costController = svc
  }

  // Injected lazily by EvolutionaryService.onModuleInit() to avoid circular dep
  setEvolutionary(svc: { getActiveStrategy: (taskType: string) => Promise<{ systemPrompt: string; tier: number } | null> }) {
    this.evolutionary = svc
  }

  selectTier(req: AIRequest): TierConfig {
    const minTier = req.tier ?? (req.taskType ? TASK_DEFAULT_TIER[req.taskType] : 3)
    const maxTier = req.maxTier ?? 4
    const clampedTier = Math.max(2, Math.min(maxTier, minTier))
    return TIERS.find((t) => t.tier >= clampedTier) ?? TIERS[TIERS.length - 1]
  }

  async complete(req: AIRequest): Promise<AIResponse> {
    // Use active evolved strategy's systemPrompt + tier if one exists for this taskType
    let effectiveReq = req
    if (req.taskType && this.evolutionary && !req.systemPrompt) {
      const strategy = await this.evolutionary.getActiveStrategy(req.taskType).catch(() => null)
      if (strategy) {
        effectiveReq = {
          ...req,
          systemPrompt: strategy.systemPrompt,
          tier: strategy.tier as 2 | 3 | 4,
        }
        this.logger.debug(`Using evolved strategy for taskType=${req.taskType} tier=${strategy.tier}`)
      }
    }
    const tier = this.selectTier(effectiveReq)
    return this.callTier(effectiveReq, tier, 0)
  }

  private async callTier(req: AIRequest, tier: TierConfig, retries: number): Promise<AIResponse> {
    const t0 = Date.now()
    const messages = req.messages ?? [
      ...(req.systemPrompt ? [{ role: 'system', content: req.systemPrompt }] : []),
      { role: 'user', content: req.prompt ?? '' },
    ]

    try {
      const res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.masterKey}`,
        },
        body: JSON.stringify({
          model:      tier.model,
          messages,
          max_tokens: req.maxTokens ?? tier.maxTokens,
          temperature: 0.2,
          ...(req.tools?.length ? {
            tools: req.tools.map((t) => ({
              type: 'function',
              function: { name: t.name, description: t.description, parameters: t.parameters },
            })),
            tool_choice: 'auto',
          } : {}),
        }),
      })

      if (!res.ok) {
        // Escalate on server error if tier < 4 — mas nunca pra tier 4 com tools ativas
        // (Claude/Anthropic rejeita nomes de tool com ':', formato incompatível).
        const next = TIERS.find((t) => t.tier > tier.tier)
        const wouldEscalateToIncompatiblePremium = req.tools?.length && next?.model === 'gpt-4o-premium'
        if (res.status >= 500 && tier.tier < 4 && retries < 2 && next && !wouldEscalateToIncompatiblePremium) {
          this.logger.warn(`tier ${tier.tier} failed (${res.status}), escalating to ${next.tier}`)
          return this.callTier(req, next, retries + 1)
        }
        const err = new Error(`LiteLLM ${res.status}: ${await res.text()}`) as Error & { status?: number }
        err.status = res.status
        throw err
      }

      const data = await res.json() as {
        choices: Array<{ message: {
          content: string | null
          tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>
        } }>
        usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number }
        model: string
      }

      const message  = data.choices?.[0]?.message
      const content  = message?.content ?? ''
      const tokensIn = data.usage?.prompt_tokens ?? 0
      const tokensOut = data.usage?.completion_tokens ?? 0
      const costUsd  = ((tokensIn + tokensOut) / 1_000_000) * tier.costPer1M
      const durationMs = Date.now() - t0

      const toolCalls: AIToolCall[] | undefined = message?.tool_calls?.map((tc) => {
        let args: Record<string, unknown> = {}
        try { args = JSON.parse(tc.function.arguments) } catch { /* arguments malformados — ignora */ }
        return { id: tc.id, name: tc.function.name, arguments: args }
      })

      this.logger.debug(`tier=${tier.tier} model=${tier.model} tokens=${tokensIn}+${tokensOut} cost=$${costUsd.toFixed(6)} ${durationMs}ms`)

      // Record cost asynchronously (fire-and-forget)
      if (this.costController && req.projectId) {
        void this.costController.record({
          projectId: req.projectId,
          model:     data.model ?? tier.model,
          tokensIn, tokensOut, costUsd,
          module: 'ai-router',
        }).catch(() => null)
      }

      return {
        content,
        modelUsed:  data.model ?? tier.model,
        tier:       tier.tier,
        tokensIn,
        tokensOut,
        costUsd,
        durationMs,
        retries,
        ...(toolCalls?.length ? { toolCalls } : {}),
      }
    } catch (e) {
      // 4xx é erro definitivo do cliente (payload/schema inválido) — escalar pra outro
      // modelo não resolve, só mascara a causa real e (com tools) ainda quebra de outro
      // jeito no tier 4 (Claude rejeita nomes de tool com ':', formato OpenAI != Anthropic).
      const status = (e as { status?: number }).status
      const isClientError = typeof status === 'number' && status >= 400 && status < 500
      // Nunca escala request com tools pro tier 4 — nomes "jarvis:algo" não passam na
      // validação de nome de tool da Anthropic (^[a-zA-Z0-9_-]{1,128}$).
      const nextTier = TIERS.find((t) => t.tier > tier.tier)
      const wouldEscalateToIncompatiblePremium = req.tools?.length && nextTier?.model === 'gpt-4o-premium'
      if (!isClientError && !wouldEscalateToIncompatiblePremium && tier.tier < 4 && retries < 2 && nextTier) {
        this.logger.warn(`tier ${tier.tier} error, escalating: ${e}`)
        return this.callTier(req, nextTier, retries + 1)
      }
      throw e
    }
  }

  getModels() {
    return TIERS.map(({ tier, model, costPer1M, maxTokens, taskTypes }) => ({
      tier, model, costPer1M, maxTokens, taskTypes,
    }))
  }
}
