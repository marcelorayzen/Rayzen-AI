import { Injectable, Logger, InternalServerErrorException, Optional } from '@nestjs/common'
import { costUsdFor } from './model-pricing.const'
// Import de valor, não `import type`: o Nest resolve o token de injeção pelo
// `design:paramtypes` emitido pelo decorator, e um tipo apagado em build vira
// `Object` — injeção que falha calada, que é o bug que este arquivo corrige.
import { CostControllerService } from '../cost-controller/cost-controller.service'

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface LlmCallOptions {
  model?:       string
  temperature?: number
  maxTokens?:   number
  /** Tentativas extras em 429/5xx. 0 desliga o retry. Padrão 3. */
  maxRetries?:  number
  /**
   * Quem está chamando — vira o nome do trace no Langfuse. Sem isso toda chamada
   * aparece como `litellm-acompletion`, indistinguível entre benchmark, QA
   * Scientist e evolutionary. Ex: `benchmark:run`, `qa-scientist:analyze`.
   */
  caller?:      string
  /**
   * Projeto dono da chamada — sem ele o custo não é registrado.
   *
   * Só o AiRouterService gravava CostRecord, e benchmark, QA Scientist e
   * evolutionary passam por aqui: as ~200 chamadas de 2026-08-13 custaram zero
   * segundo o banco. Um painel de custo sobre esse dado mostraria $0.69 de junho
   * e omitiria o gasto real.
   */
  projectId?:   string
}

export interface LlmResult {
  content:     string
  tokensUsed:  number
  /** Duração só da tentativa que deu certo — é a latência do modelo. */
  durationMs:  number
  /** Tempo de parede incluindo esperas de retry. Use para custo operacional, nunca como métrica de qualidade. */
  totalMs:     number
  retries:     number
}

@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name)
  private readonly baseUrl: string
  private readonly masterKey: string

  /**
   * Injeção direta, não setter tardio.
   *
   * O AiRouterService tem um `setCostController()` que **ninguém nunca chamou** —
   * o campo fica null e o bloco que grava custo jamais executa. Foi assim que a V2
   * passou de junho a agosto sem registrar um centavo. Um setter que depende de
   * alguém lembrar de ligá-lo é a mesma classe de falha silenciosa que estamos
   * caçando; DI ou está ligado ou o boot quebra.
   *
   * `@Optional` só porque os specs constroem `new LlmService()` direto — e a
   * ausência vira log, não silêncio.
   */
  constructor(
    @Optional() private readonly costController?: CostControllerService,
  ) {
    this.baseUrl = (process.env.LITELLM_BASE_URL ?? 'http://litellm:4000/v1').replace(/\/$/, '')
    this.masterKey = process.env.LITELLM_MASTER_KEY ?? ''
    if (!this.costController) {
      this.logger.warn('CostControllerService indisponível — chamadas LLM não terão custo registrado')
    }
  }

  /** Teto por espera — sem isso um "try again in 3600s" travaria o processo. */
  private static readonly MAX_BACKOFF_MS = 30_000

  async chat(messages: LlmMessage[], opts: LlmCallOptions = {}): Promise<LlmResult> {
    const model      = opts.model ?? 'gpt-4o-mini'
    const maxRetries = opts.maxRetries ?? 3
    const t0 = Date.now()

    for (let attempt = 0; ; attempt++) {
      // Cronômetro por tentativa: somar a espera do 429 à latência do modelo faria
      // uma janela de rate limit parecer um modelo lento. No benchmark isso saturava
      // a normalização de latência (10s) e derrubava a fitness de uma rodada
      // perfeitamente boa — condição de infra virando medição de qualidade.
      const attemptStart = Date.now()
      const res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.masterKey}`,
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: opts.temperature ?? 0,
          max_tokens:  opts.maxTokens ?? 2048,
          // Encaminhado ao Langfuse pelo LiteLLM — ver comentário em LlmCallOptions.caller.
          metadata: {
            trace_name: opts.caller ? `rayzen:${opts.caller}` : 'rayzen:desconhecido',
            ...(opts.caller ? { tags: [opts.caller] } : {}),
          },
        }),
      })

      if (res.ok) {
        const data = await res.json() as {
          model?: string
          choices: Array<{ message: { content: string } }>
          usage: { total_tokens: number; prompt_tokens?: number; completion_tokens?: number }
        }

        const content    = data.choices?.[0]?.message?.content ?? ''
        const tokensUsed = data.usage?.total_tokens ?? 0
        const durationMs = Date.now() - attemptStart
        const totalMs    = Date.now() - t0

        this.recordCost(data, model, tokensUsed, opts)

        this.logger.debug(`${model} | ${tokensUsed} tokens | ${durationMs}ms${attempt > 0 ? ` | ${attempt} retry(s), ${totalMs}ms total` : ''}`)
        return { content, tokensUsed, durationMs, totalMs, retries: attempt }
      }

      const body = await res.text()

      // 429 do Groq free tier é o caso normal, não excepcional: o TPM (6000 em
      // llama-3.1-8b-instant) estoura em qualquer lote e o LiteLLM ainda põe o
      // deployment em cooldown, devolvendo "No deployments available" nas chamadas
      // seguintes. Sem retry, um benchmark de 46 casos falhava 46 vezes. O servidor
      // diz quanto esperar — obedecer isso é o que faz a rodada caber no free tier.
      const retriable = res.status === 429 || res.status >= 500
      if (!retriable || attempt >= maxRetries) {
        this.logger.error(`LiteLLM error ${res.status}: ${body}`)
        // Corpo no erro: só o status tornava impossível distinguir "sem crédito na
        // Anthropic" de "TPM estourado no Groq" sem ir ler o log do container.
        throw new InternalServerErrorException(`LLM call failed: ${res.status} — ${body.slice(0, 500)}`)
      }

      const waitMs = this.parseRetryDelayMs(res, body, attempt)
      this.logger.warn(`LiteLLM ${res.status} em ${model} — tentativa ${attempt + 1}/${maxRetries}, aguardando ${waitMs}ms`)
      await new Promise((r) => setTimeout(r, waitMs))
    }
  }

  /**
   * Grava o custo da chamada. Fire-and-forget: contabilidade não derruba a resposta.
   *
   * Silencioso sem `projectId` — custo sem dono não é agregável por projeto, e um
   * registro órfão no painel é pior que a ausência dele. Quem chama sem projectId
   * (ex.: o avaliador do benchmark) aparece no Langfuse pelo `caller`.
   */
  private recordCost(
    data: { model?: string; usage: { total_tokens: number; prompt_tokens?: number; completion_tokens?: number } },
    modelAlias: string,
    tokensUsed: number,
    opts: LlmCallOptions,
  ): void {
    if (!this.costController || !opts.projectId || tokensUsed === 0) return

    // Preço vem do alias que pedimos (`gpt-4o-mini`), mas o registro guarda o
    // modelo que de fato respondeu (`groq/llama-3.1-8b-instant`) — sem isso um
    // fallback silencioso para o Claude ficaria indistinguível no painel.
    const tokensIn  = data.usage?.prompt_tokens     ?? 0
    const tokensOut = data.usage?.completion_tokens ?? Math.max(0, tokensUsed - tokensIn)

    void this.costController.record({
      projectId: opts.projectId,
      model:     data.model ?? modelAlias,
      tokensIn,
      tokensOut,
      costUsd:   costUsdFor(modelAlias, tokensUsed),
      // O `caller` já identifica a origem no Langfuse; usar o mesmo rótulo aqui
      // deixa as duas visões comparáveis sem tradução no meio.
      module:    opts.caller ?? 'llm',
    }).catch(() => null)
  }

  /**
   * Quanto esperar antes de repetir. Prefere sempre o que o servidor informou —
   * backoff cego ou espera demais ou volta cedo e queima outra tentativa à toa.
   */
  private parseRetryDelayMs(res: Response, body: string, attempt: number): number {
    const header = Number(res.headers.get('retry-after'))
    if (Number.isFinite(header) && header > 0) {
      return Math.min(header * 1000, LlmService.MAX_BACKOFF_MS)
    }

    // LiteLLM: "Try again in 20 seconds" · Groq: "Please try again in 6.31s"
    const match = body.match(/try again in\s+([\d.]+)\s*(s\b|seconds?)/i)
    if (match) {
      const seconds = parseFloat(match[1])
      if (Number.isFinite(seconds) && seconds > 0) {
        // +250ms de folga: voltar no instante exato costuma pegar o mesmo 429.
        return Math.min(Math.round(seconds * 1000) + 250, LlmService.MAX_BACKOFF_MS)
      }
    }

    return Math.min(1000 * 2 ** attempt, LlmService.MAX_BACKOFF_MS)
  }

  extractJson(text: string): unknown {
    // Strip <think>...</think> reasoning blocks (llama/DeepSeek variants)
    let clean = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim()
    // Remove single code fence wrapper
    clean = clean.replace(/^```(?:json|javascript|js)?\s*/im, '').replace(/\s*```$/m, '').trim()

    // Walk forward to first { or [, then balance brackets ignoring strings
    const start = clean.search(/[{[]/)
    if (start === -1) throw new Error('No JSON found in LLM response')

    const opener = clean[start]
    const closer = opener === '{' ? '}' : ']'
    let depth = 0
    let inString = false
    let escape = false

    for (let i = start; i < clean.length; i++) {
      const c = clean[i]
      if (escape)              { escape = false; continue }
      if (c === '\\' && inString) { escape = true; continue }
      if (c === '"')           { inString = !inString; continue }
      if (inString)            continue
      if (c === opener)        depth++
      else if (c === closer) {
        depth--
        if (depth === 0) return JSON.parse(clean.slice(start, i + 1))
      }
    }
    throw new Error('Unbalanced JSON in LLM response')
  }
}
