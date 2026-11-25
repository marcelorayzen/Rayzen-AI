import { BenchmarkService } from '../benchmark.service'

/**
 * Falha de LLM não pode virar dado de qualidade.
 *
 * Aconteceu de verdade em 2026-08-07: uma rodada de 46 casos gravou 46
 * BenchmarkResults com accuracy 0 e fitness ~0.29 — não porque os prompts fossem
 * ruins, mas porque o Groq estourou o TPM do free tier e o fallback Claude estava
 * sem crédito. Nenhuma chamada chegou a acontecer.
 *
 * O estrago não para no número errado: o QA Scientist coleta fitness < 0.5 dos
 * últimos 7 dias como sinal de falha e teria gerado hipótese de "qualidade de
 * prompt" para uma queda de infraestrutura — a mesma classe de ruído que o filtro
 * de `skill_repeated_failure:jarvis:` já evita no outro sinal.
 */
describe('BenchmarkService.runForStrategy — falha de LLM não vira resultado', () => {
  function buildService(
    chatImpl: jest.Mock,
    cases = [{ id: 'c1', input: 'entrada 1', expected: 'esperado 1' }],
    strategy: { systemPrompt: string } | null = { systemPrompt: 'prompt da estratégia' },
  ) {
    const prisma = {
      benchmarkCase:   { findMany: jest.fn().mockResolvedValue(cases) },
      benchmarkResult: { create: jest.fn().mockResolvedValue({}) },
      strategy:        {
        findUnique: jest.fn().mockResolvedValue(strategy),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    }
    const llm = { chat: chatImpl }
    const service = new BenchmarkService(prisma as never, llm as never)
    return { service, prisma, llm }
  }

  const ok = (content: string) => ({ content, tokensUsed: 100 })

  it('não grava BenchmarkResult quando a chamada falha', async () => {
    const chat = jest.fn().mockRejectedValue(new Error('LLM call failed: 429'))
    const { service, prisma } = buildService(chat)

    const res = await service.runForStrategy({ strategyId: 's1' })

    expect(prisma.benchmarkResult.create).not.toHaveBeenCalled()
    expect(res.total).toBe(0)
    expect(res.skipped).toBe(1)
    expect(res.avgFitness).toBe(0)
  })

  it('não chama o avaliador de accuracy para um caso que falhou', async () => {
    // evaluateAccuracy é outra chamada de LLM — gastar nela em cima de output vazio
    // é queimar quota justamente quando a quota é o problema.
    const chat = jest.fn().mockRejectedValue(new Error('429'))
    const { service } = buildService(chat)

    await service.runForStrategy({ strategyId: 's1' })

    expect(chat).toHaveBeenCalledTimes(1)
  })

  it('média usa só os casos que produziram resultado, não o total varrido', async () => {
    const chat = jest.fn()
      .mockResolvedValueOnce(ok('resposta boa'))
      .mockResolvedValueOnce(ok('{"score": 0.8}'))  // evaluateAccuracy do caso 1
      .mockRejectedValueOnce(new Error('429'))   // caso 2 morre
    const { service, prisma } = buildService(chat, [
      { id: 'c1', input: 'a', expected: 'a' },
      { id: 'c2', input: 'b', expected: 'b' },
    ])

    const res = await service.runForStrategy({ strategyId: 's1' })

    expect(prisma.benchmarkResult.create).toHaveBeenCalledTimes(1)
    expect(res.total).toBe(1)
    expect(res.skipped).toBe(1)
    expect(res.avgAccuracy).toBeCloseTo(0.8, 5)
  })

  it('não grava resultado quando a geração funcionou mas o avaliador não conseguiu julgar', async () => {
    // evaluateAccuracy devolvia 0.5 tanto para "não parseei" quanto para "a chamada
    // falhou" — um valor plausível no meio da escala, indistinguível de avaliação
    // real. Agora devolve null e o caso é pulado.
    const chat = jest.fn()
      .mockResolvedValueOnce(ok('resposta gerada'))
      .mockResolvedValueOnce(ok('desculpe, não sei avaliar isso'))   // sem "score"
    const { service, prisma } = buildService(chat)

    const res = await service.runForStrategy({ strategyId: 's1' })

    expect(prisma.benchmarkResult.create).not.toHaveBeenCalled()
    expect(res).toMatchObject({ total: 0, skipped: 1 })
  })

  it('não grava resultado quando o avaliador em si falha', async () => {
    const chat = jest.fn()
      .mockResolvedValueOnce(ok('resposta gerada'))
      .mockRejectedValueOnce(new Error('429'))
    const { service, prisma } = buildService(chat)

    const res = await service.runForStrategy({ strategyId: 's1' })

    expect(prisma.benchmarkResult.create).not.toHaveBeenCalled()
    expect(res.skipped).toBe(1)
  })

  it('pede mais retries que o padrão — lote em free tier espera, não desiste', async () => {
    const chat = jest.fn()
      .mockResolvedValueOnce(ok('resposta'))
      .mockResolvedValueOnce(ok('{"score": 0.9}'))
    const { service } = buildService(chat)

    await service.runForStrategy({ strategyId: 's1' })

    for (const call of chat.mock.calls) {
      expect(call[1]).toMatchObject({ maxRetries: 6 })
    }
  })

  it('persiste o fitness medido na estratégia — na origem, não em cada orquestrador', async () => {
    // evaluatePopulation e runExperiment tinham cópia própria disto, e quem chamava
    // a rota direto não tinha nenhuma: em 2026-08-13 quatro estratégias recém-medidas
    // ficaram com fitnessScore null, invisíveis ao getActiveStrategy.
    const chat = jest.fn()
      .mockResolvedValueOnce(ok('saida'))
      .mockResolvedValueOnce(ok('{"score": 0.9}'))
    const { service, prisma } = buildService(chat)

    const res = await service.runForStrategy({ strategyId: 's1', systemPrompt: 'p' })

    expect(prisma.strategy.updateMany).toHaveBeenCalledWith({
      where: { id: 's1' }, data: { fitnessScore: res.avgFitness },
    })
  })

  it('updateMany não quebra com strategyId livre que não existe em Strategy', async () => {
    // strategyId é id livre: rodadas ad-hoc como "summarize-ptbr-v1" não têm registro.
    const chat = jest.fn()
      .mockResolvedValueOnce(ok('saida'))
      .mockResolvedValueOnce(ok('{"score": 0.5}'))
    const { service, prisma } = buildService(chat)
    prisma.strategy.updateMany.mockResolvedValue({ count: 0 })

    await expect(service.runForStrategy({ strategyId: 'ad-hoc', systemPrompt: 'p' })).resolves.toBeDefined()
  })

  it('retorna skipped 0 quando não há caso nenhum', async () => {
    const { service } = buildService(jest.fn(), [])

    const res = await service.runForStrategy({ strategyId: 's1' })

    expect(res).toMatchObject({ total: 0, skipped: 0, results: [] })
  })

  describe('o prompt é o que está sendo medido — sem default silencioso', () => {
    // Havia um: 'You are a helpful assistant. Complete the task precisely.'. Com ele,
    // uma rodada real de classify (casos que esperam o rótulo "deploy") recebeu
    // redações de três parágrafos e pontuou accuracy 0.044 — número verdadeiro,
    // medição sem sentido, de um prompt que nenhum módulo usa.
    it('usa o systemPrompt informado', async () => {
      const chat = jest.fn()
        .mockResolvedValueOnce(ok('saida'))
        .mockResolvedValueOnce(ok('{"score": 1}'))
      const { service } = buildService(chat)

      await service.runForStrategy({ strategyId: 's1', systemPrompt: 'prompt explícito' })

      expect(chat.mock.calls[0][0][0]).toEqual({ role: 'system', content: 'prompt explícito' })
    })

    it('cai no prompt da estratégia registrada quando nenhum é informado', async () => {
      const chat = jest.fn()
        .mockResolvedValueOnce(ok('saida'))
        .mockResolvedValueOnce(ok('{"score": 1}'))
      const { service, prisma } = buildService(chat)

      await service.runForStrategy({ strategyId: 's1' })

      expect(prisma.strategy.findUnique).toHaveBeenCalledWith({
        where: { id: 's1' }, select: { systemPrompt: true },
      })
      expect(chat.mock.calls[0][0][0]).toEqual({ role: 'system', content: 'prompt da estratégia' })
    })

    it('falha quando não há prompt nem estratégia registrada', async () => {
      const { service, prisma } = buildService(jest.fn(), undefined, null)

      await expect(service.runForStrategy({ strategyId: 'inexistente' }))
        .rejects.toThrow(/exige systemPrompt/)
      expect(prisma.benchmarkResult.create).not.toHaveBeenCalled()
    })

    it('prompt em branco não conta como informado', async () => {
      const { service } = buildService(jest.fn(), undefined, null)

      await expect(service.runForStrategy({ strategyId: 'x', systemPrompt: '   ' }))
        .rejects.toThrow(/exige systemPrompt/)
    })
  })
})
