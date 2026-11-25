import { BadGatewayException, Injectable, ServiceUnavailableException } from '@nestjs/common'

export type HermesRuntimeReply = {
  text: string
  runtimeRunId: string | null
}

export function obterTimeoutHermesRuntimeMs() {
  return Number(process.env.HUB_RUNTIME_TIMEOUT_MS) || 600_000
}

/**
 * Único cliente da capacidade de conversa do Hermes. A URL resolve apenas na
 * rede Docker e a chave nunca é enviada ao browser nem registrada em eventos.
 */
@Injectable()
export class HermesRuntimeClient {
  private readonly baseUrl = process.env.HERMES_RUNTIME_URL?.replace(/\/$/, '')
  private readonly apiKey = process.env.HERMES_RUNTIME_API_KEY

  async sendText(input: { sessionId: string; text: string; idempotencyKey: string; context?: string }): Promise<HermesRuntimeReply> {
    if (!this.baseUrl || !this.apiKey) {
      throw new ServiceUnavailableException({ code: 'hub_runtime_not_configured' })
    }

    let response: Response
    try {
      response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
        method: 'POST',
        signal: AbortSignal.timeout(obterTimeoutHermesRuntimeMs()),
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': input.idempotencyKey,
          'X-Hermes-Session-Id': input.sessionId,
        },
        body: JSON.stringify({
          // O modelo real continua resolvido pelo Hermes/LiteLLM; este valor só
          // satisfaz o envelope OpenAI compatível sem dar escolha ao browser.
          model: 'rayzen-hub',
          stream: false,
          messages: [
            ...(input.context ? [{ role: 'system', content: input.context }] : []),
            { role: 'user', content: input.text },
          ],
        }),
      })
    } catch (error) {
      const name = typeof error === 'object' && error !== null && 'name' in error ? error.name : undefined
      if (name === 'TimeoutError' || name === 'AbortError') {
        throw new BadGatewayException({ code: 'hub_runtime_timeout' })
      }
      throw new BadGatewayException({ code: 'hub_runtime_unreachable' })
    }

    if (!response.ok) {
      throw new BadGatewayException({ code: 'hub_runtime_rejected', status: response.status })
    }

    let body: { id?: string; choices?: Array<{ message?: { content?: unknown } }> }
    try {
      body = await response.json() as typeof body
    } catch {
      throw new BadGatewayException({ code: 'hub_runtime_invalid_response' })
    }
    const text = body.choices?.[0]?.message?.content
    if (typeof text !== 'string') {
      throw new BadGatewayException({ code: 'hub_runtime_invalid_response' })
    }
    return { text, runtimeRunId: body.id ?? null }
  }
}
