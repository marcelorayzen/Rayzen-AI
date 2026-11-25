import { createLlmClient } from '../llm-client'

/**
 * A V1 mandava toda chamada ao LiteLLM sem identificação: em 2026-08-14, numa
 * janela de 2h, 26 de 31 traces do Langfuse eram `litellm-acompletion` anônimos,
 * todos com `User-Agent: OpenAI/JS 4.104.0` — todos daqui. A V2 já ia nomeada.
 */
describe('createLlmClient', () => {
  const originalFetch = global.fetch
  let enviado: { url: string; body: Record<string, unknown>; headers: Record<string, string>; bodyRaw: string }[]

  beforeEach(() => {
    enviado = []
    global.fetch = jest.fn(async (url: unknown, init?: RequestInit) => {
      const bodyRaw = typeof init?.body === 'string' ? init.body : ''
      enviado.push({
        url:     String(url),
        body:    bodyRaw ? JSON.parse(bodyRaw) : {},
        bodyRaw,
        headers: { ...(init?.headers as Record<string, string> | undefined) },
      })
      return new Response(
        JSON.stringify({
          id: 'x', object: 'chat.completion', created: 0, model: 'gpt-4o-mini',
          choices: [{ index: 0, message: { role: 'assistant', content: 'oi' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }) as unknown as typeof fetch
  })

  afterEach(() => { global.fetch = originalFetch })

  const cliente = (mod: string) =>
    createLlmClient(mod, { apiKey: 'sk-teste', baseURL: 'http://litellm:4000/v1' })

  it('nomeia o trace com o módulo que construiu o cliente', async () => {
    await cliente('orchestrator').chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'oi' }],
    })

    expect(enviado[0].body.metadata).toEqual({
      trace_name: 'rayzen:v1:orchestrator',
      tags:       ['v1:orchestrator'],
    })
  })

  it('respeita metadata que o call site já definiu', async () => {
    await cliente('graph').chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'oi' }],
      metadata: { trace_name: 'rayzen:explicito' },
    })

    expect((enviado[0].body.metadata as Record<string, string>).trace_name).toBe('rayzen:explicito')
  })

  it('não toca em embeddings', async () => {
    // Restrição deliberada: mandar campo desconhecido para um endpoint que talvez
    // não o aceite arriscaria quebrar a indexação de memória por uma questão de
    // observabilidade.
    await cliente('memory').embeddings.create({ model: 'jina', input: 'texto' })

    expect(enviado[0].url).toContain('/embeddings')
    expect(enviado[0].body.metadata).toBeUndefined()
  })

  /**
   * O primeiro teste desta suite passou verde enquanto a produção estava
   * quebrada: ele mockava o fetch e olhava só o corpo, nunca o contrato de
   * transporte. O SDK declara `content-length` explicitamente; corpo maior com
   * o número antigo faz o servidor ler bytes de menos, receber JSON truncado e
   * esperar o resto para sempre — pendura sem erro em lugar nenhum.
   */
  it('corrige o content-length depois de aumentar o corpo', async () => {
    await cliente('orchestrator').chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'oi' }],
    })

    const cl = Object.entries(enviado[0].headers).find(([k]) => k.toLowerCase() === 'content-length')
    expect(cl).toBeDefined()
    expect(Number(cl![1])).toBe(Buffer.byteLength(enviado[0].bodyRaw))
  })

  it('conta bytes e não caracteres — prompt com acento tem que bater', async () => {
    await cliente('synthesis').chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'ação, decisão e manutenção — çãõé' }],
    })

    const cl = Object.entries(enviado[0].headers).find(([k]) => k.toLowerCase() === 'content-length')!
    // Se contasse caracteres, este seria menor que o real e recriaria o bug.
    expect(Number(cl[1])).toBe(Buffer.byteLength(enviado[0].bodyRaw))
    expect(Number(cl[1])).toBeGreaterThan(enviado[0].bodyRaw.length)
  })

  it('preserva o resto do corpo intacto', async () => {
    await cliente('synthesis').chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'oi' }],
      temperature: 0.3,
      max_tokens: 512,
    })

    expect(enviado[0].body).toMatchObject({
      model: 'gpt-4o-mini',
      temperature: 0.3,
      max_tokens: 512,
      messages: [{ role: 'user', content: 'oi' }],
    })
  })
})
