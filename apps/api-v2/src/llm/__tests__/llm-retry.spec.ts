import { LlmService } from '../llm.service'

/**
 * Retry em 429 — o Groq free tier é o caminho normal, não a exceção.
 *
 * Em 2026-08-07 um benchmark de 46 casos falhou 46 vezes: o TPM do
 * `llama-3.1-8b-instant` (6000) estoura em qualquer lote e o LiteLLM ainda põe o
 * deployment em cooldown, respondendo "No deployments available" às chamadas
 * seguintes. Sem retry não existe rodada possível em free tier — e o fallback pago
 * (Claude) estava sem crédito, então não havia para onde escapar.
 *
 * O servidor sempre informa quanto esperar; obedecer isso é o que faz o lote caber.
 */
describe('LlmService.chat — retry em 429', () => {
  const originalFetch = global.fetch
  let waited: number[]

  beforeEach(() => {
    waited = []
    jest.spyOn(global, 'setTimeout').mockImplementation(((fn: () => void, ms?: number) => {
      waited.push(ms ?? 0)
      fn()
      return 0 as unknown as NodeJS.Timeout
    }) as unknown as typeof setTimeout)
  })

  afterEach(() => {
    jest.restoreAllMocks()
    global.fetch = originalFetch
  })

  const okResponse = () => ({
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content: 'resposta' } }], usage: { total_tokens: 42 } }),
  })

  const errResponse = (status: number, body: string, headers: Record<string, string> = {}) => ({
    ok: false,
    status,
    text: async () => body,
    headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
  })

  function mockFetch(...responses: unknown[]) {
    const fn = jest.fn()
    for (const r of responses) fn.mockResolvedValueOnce(r)
    global.fetch = fn as unknown as typeof fetch
    return fn
  }

  it('não conta a espera do retry como latência do modelo', async () => {
    // Medido de verdade em 2026-08-07: uma rodada com retries reportou latência média
    // de 10743ms — acima do teto de normalização de 10s do calcFitness — e derrubou a
    // fitness de 13 casos perfeitamente executados. A espera é custo operacional,
    // não lentidão do modelo.
    let now = 1000
    jest.spyOn(Date, 'now').mockImplementation(() => now)
    global.fetch = jest.fn()
      .mockImplementationOnce(async () => { now += 100; return errResponse(429, 'Try again in 20 seconds') })
      .mockImplementationOnce(async () => { now += 300; return okResponse() }) as unknown as typeof fetch

    const service = new LlmService()
    const res = await service.chat([{ role: 'user', content: 'oi' }])

    expect(res.durationMs).toBe(300)      // só a tentativa que deu certo
    expect(res.totalMs).toBeGreaterThan(res.durationMs)
    expect(res.retries).toBe(1)
  })

  it('repete depois de um 429 e devolve o resultado', async () => {
    const fetchMock = mockFetch(
      errResponse(429, '{"error":{"message":"Rate limit reached"}}'),
      okResponse(),
    )
    const service = new LlmService()

    const res = await service.chat([{ role: 'user', content: 'oi' }])

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(res.content).toBe('resposta')
    expect(res.tokensUsed).toBe(42)
  })

  it('obedece o header Retry-After em vez de chutar backoff', async () => {
    mockFetch(errResponse(429, 'rate limited', { 'retry-after': '7' }), okResponse())
    const service = new LlmService()

    await service.chat([{ role: 'user', content: 'oi' }])

    expect(waited).toEqual([7000])
  })

  it('lê o tempo de espera da mensagem do LiteLLM quando não há header', async () => {
    mockFetch(
      errResponse(429, '{"error":{"message":"No deployments available for selected model, Try again in 20 seconds."}}'),
      okResponse(),
    )
    const service = new LlmService()

    await service.chat([{ role: 'user', content: 'oi' }])

    expect(waited).toEqual([20250])   // +250ms de folga
  })

  it('lê o formato do Groq com fração de segundo', async () => {
    mockFetch(
      errResponse(429, 'GroqException - Please try again in 6.31s. Need more tokens?'),
      okResponse(),
    )
    const service = new LlmService()

    await service.chat([{ role: 'user', content: 'oi' }])

    expect(waited).toEqual([6560])
  })

  it('limita a espera — "try again in 3600s" não pode travar o processo', async () => {
    mockFetch(errResponse(429, 'Try again in 3600 seconds', {}), okResponse())
    const service = new LlmService()

    await service.chat([{ role: 'user', content: 'oi' }])

    expect(waited).toEqual([30_000])
  })

  it('usa backoff exponencial quando o servidor não diz nada', async () => {
    mockFetch(
      errResponse(429, 'rate limited'),
      errResponse(429, 'rate limited'),
      errResponse(429, 'rate limited'),
      okResponse(),
    )
    const service = new LlmService()

    await service.chat([{ role: 'user', content: 'oi' }])

    expect(waited).toEqual([1000, 2000, 4000])
  })

  it('desiste depois de maxRetries e inclui o corpo do erro na exceção', async () => {
    // Sem o corpo era impossível distinguir "sem crédito na Anthropic" de "TPM
    // estourado no Groq" sem abrir o log do container.
    const corpo = '{"error":{"message":"Your credit balance is too low to access the Anthropic API"}}'
    mockFetch(errResponse(429, corpo), errResponse(429, corpo))
    const service = new LlmService()

    await expect(service.chat([{ role: 'user', content: 'oi' }], { maxRetries: 1 }))
      .rejects.toThrow(/credit balance is too low/)
  })

  it('não repete em erro de cliente que não é 429', async () => {
    const fetchMock = mockFetch(errResponse(400, 'modelo inexistente'))
    const service = new LlmService()

    await expect(service.chat([{ role: 'user', content: 'oi' }])).rejects.toThrow(/400/)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('repete em 5xx', async () => {
    const fetchMock = mockFetch(errResponse(503, 'upstream indisponivel'), okResponse())
    const service = new LlmService()

    await service.chat([{ role: 'user', content: 'oi' }])

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('maxRetries 0 desliga o retry', async () => {
    const fetchMock = mockFetch(errResponse(429, 'rate limited'))
    const service = new LlmService()

    await expect(service.chat([{ role: 'user', content: 'oi' }], { maxRetries: 0 })).rejects.toThrow()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
