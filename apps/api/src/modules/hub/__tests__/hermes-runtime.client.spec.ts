import { ServiceUnavailableException } from '@nestjs/common'
import { HermesRuntimeClient } from '../hermes-runtime.client'

describe('HermesRuntimeClient — credencial só servidor', () => {
  const originalUrl = process.env.HERMES_RUNTIME_URL
  const originalKey = process.env.HERMES_RUNTIME_API_KEY
  const originalTimeout = process.env.HUB_RUNTIME_TIMEOUT_MS
  const originalFetch = global.fetch

  afterEach(() => {
    process.env.HERMES_RUNTIME_URL = originalUrl
    process.env.HERMES_RUNTIME_API_KEY = originalKey
    process.env.HUB_RUNTIME_TIMEOUT_MS = originalTimeout
    global.fetch = originalFetch
    jest.restoreAllMocks()
  })

  it('falha fechado sem configuração do runtime', async () => {
    delete process.env.HERMES_RUNTIME_URL
    delete process.env.HERMES_RUNTIME_API_KEY

    await expect(new HermesRuntimeClient().sendText({ sessionId: 's', text: 'oi', idempotencyKey: 'i' }))
      .rejects.toBeInstanceOf(ServiceUnavailableException)
  })

  it('envia chave Bearer e sessão somente ao runtime interno', async () => {
    process.env.HERMES_RUNTIME_URL = 'http://hermes-runtime:8642/'
    process.env.HERMES_RUNTIME_API_KEY = 'segredo-apenas-servidor'
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({ id: 'run-1', choices: [{ message: { content: 'resposta' } }] }),
    })
    global.fetch = fetchMock as typeof fetch

    await expect(new HermesRuntimeClient().sendText({ sessionId: 'session-1', text: 'oi', idempotencyKey: 'idem-1' }))
      .resolves.toEqual({ text: 'resposta', runtimeRunId: 'run-1' })

    expect(fetchMock).toHaveBeenCalledWith('http://hermes-runtime:8642/v1/chat/completions', expect.objectContaining({
      signal: expect.any(AbortSignal),
      headers: expect.objectContaining({
        Authorization: 'Bearer segredo-apenas-servidor',
        'X-Hermes-Session-Id': 'session-1',
        'Idempotency-Key': 'idem-1',
      }),
    }))
  })

  it.each(['TimeoutError', 'AbortError'])('mapeia %s para timeout do runtime', async (name) => {
    process.env.HERMES_RUNTIME_URL = 'http://hermes-runtime:8642'
    process.env.HERMES_RUNTIME_API_KEY = 'segredo-apenas-servidor'
    process.env.HUB_RUNTIME_TIMEOUT_MS = '1234'
    const timeoutSpy = jest.spyOn(AbortSignal, 'timeout')
    const timeoutError = Object.assign(new Error('request aborted'), { name })
    const fetchMock = jest.fn().mockRejectedValue(timeoutError)
    global.fetch = fetchMock as typeof fetch

    await expect(new HermesRuntimeClient().sendText({ sessionId: 's', text: 'oi', idempotencyKey: 'i' }))
      .rejects.toMatchObject({ response: { code: 'hub_runtime_timeout' } })

    expect(fetchMock).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      signal: expect.any(AbortSignal),
    }))
    expect(timeoutSpy).toHaveBeenCalledWith(1234)
  })

  it('mantém erros comuns de rede como runtime inacessível', async () => {
    process.env.HERMES_RUNTIME_URL = 'http://hermes-runtime:8642'
    process.env.HERMES_RUNTIME_API_KEY = 'segredo-apenas-servidor'
    global.fetch = jest.fn().mockRejectedValue(new TypeError('network failure')) as typeof fetch

    await expect(new HermesRuntimeClient().sendText({ sessionId: 's', text: 'oi', idempotencyKey: 'i' }))
      .rejects.toMatchObject({ response: { code: 'hub_runtime_unreachable' } })
  })
})
