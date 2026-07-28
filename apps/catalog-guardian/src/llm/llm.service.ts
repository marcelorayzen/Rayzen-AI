import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

// Sempre via LiteLLM — nunca apontar direto pra OpenAI/Groq/Anthropic (mesma
// regra do resto do Rayzen, ver CLAUDE.md). O Catalog Guardian roda isolado,
// mas reaproveita o mesmo proxy já operado pelo Rayzen quando os dois
// convivem na mesma infra do cliente; em deploy standalone, aponta pra
// qualquer LiteLLM próprio via LITELLM_URL.
@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name)
  private readonly baseUrl: string
  private readonly apiKey: string
  private readonly model: string

  constructor(private readonly config: ConfigService) {
    this.baseUrl = this.config.get<string>('LITELLM_URL', 'http://localhost:4100')
    this.apiKey = this.config.get<string>('LITELLM_API_KEY', '')
    this.model = this.config.get<string>('LITELLM_MODEL', 'gpt-4o')
  }

  async complete(systemPrompt: string, userPrompt: string): Promise<string> {
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.2,
      }),
    })

    if (!res.ok) {
      throw new Error(`LiteLLM ${this.baseUrl}/chat/completions → HTTP ${res.status}: ${await res.text()}`)
    }

    const body = (await res.json()) as { choices: { message: { content: string } }[] }
    const content = body.choices?.[0]?.message?.content ?? ''
    if (!content) this.logger.warn('LiteLLM retornou resposta vazia')
    return content
  }
}
