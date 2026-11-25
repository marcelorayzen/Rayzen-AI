import { baterNaV2 } from '../system-heartbeat'

describe('baterNaV2', () => {
  const originalFetch = global.fetch
  const originalAgentToken = process.env.AGENT_TOKEN
  const originalApiV2Url = process.env.API_V2_URL

  afterEach(() => {
    global.fetch = originalFetch
    if (originalAgentToken === undefined) delete process.env.AGENT_TOKEN
    else process.env.AGENT_TOKEN = originalAgentToken
    if (originalApiV2Url === undefined) delete process.env.API_V2_URL
    else process.env.API_V2_URL = originalApiV2Url
  })

  it('autentica o heartbeat com o token de servico', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true })
    global.fetch = fetchMock
    process.env.API_V2_URL = 'http://api-v2:3002'
    process.env.AGENT_TOKEN = 'token-do-agent'

    await baterNaV2('auto-checkpoint', { ok: true })

    expect(fetchMock).toHaveBeenCalledWith(
      'http://api-v2:3002/v2/system/heartbeat',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer token-do-agent',
        }),
      }),
    )
  })

  it('nao envia heartbeat anonimo quando o token esta ausente', async () => {
    const fetchMock = jest.fn()
    global.fetch = fetchMock
    delete process.env.AGENT_TOKEN

    await baterNaV2('auto-checkpoint', { ok: true })

    expect(fetchMock).not.toHaveBeenCalled()
  })
})
