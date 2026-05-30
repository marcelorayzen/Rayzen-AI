import { Injectable, Logger, InternalServerErrorException } from '@nestjs/common'

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface LlmCallOptions {
  model?:       string
  temperature?: number
  maxTokens?:   number
}

export interface LlmResult {
  content:     string
  tokensUsed:  number
  durationMs:  number
}

@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name)
  private readonly baseUrl: string
  private readonly masterKey: string

  constructor() {
    this.baseUrl = (process.env.LITELLM_BASE_URL ?? 'http://litellm:4000/v1').replace(/\/$/, '')
    this.masterKey = process.env.LITELLM_MASTER_KEY ?? ''
  }

  async chat(messages: LlmMessage[], opts: LlmCallOptions = {}): Promise<LlmResult> {
    const model = opts.model ?? 'gpt-4o-mini'
    const t0 = Date.now()

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
      }),
    })

    if (!res.ok) {
      const err = await res.text()
      this.logger.error(`LiteLLM error ${res.status}: ${err}`)
      throw new InternalServerErrorException(`LLM call failed: ${res.status}`)
    }

    const data = await res.json() as {
      choices: Array<{ message: { content: string } }>
      usage: { total_tokens: number }
    }

    const content = data.choices?.[0]?.message?.content ?? ''
    const tokensUsed = data.usage?.total_tokens ?? 0
    const durationMs = Date.now() - t0

    this.logger.debug(`${model} | ${tokensUsed} tokens | ${durationMs}ms`)
    return { content, tokensUsed, durationMs }
  }

  extractJson(text: string): unknown {
    // Remove code fences
    const stripped = text.replace(/^```(?:json)?\s*/m, '').replace(/\s*```$/m, '').trim()
    // Find first {...} or [...]
    const match = stripped.match(/(\{[\s\S]*\}|\[[\s\S]*\])/)
    if (!match) throw new Error('No JSON found in LLM response')
    return JSON.parse(match[1])
  }
}
