import { QaScientistService } from '../qa-scientist.service'

/**
 * Baseline e promoção no experimento do QA Scientist.
 *
 * Dois defeitos encontrados no banco de produção em 2026-08-12, depois que o loop
 * finalmente passou a rodar de verdade:
 *
 * 1. `fitnessScore` null em TODAS as 5 estratégias, mesmo com BenchmarkResults
 *    gravados. `evaluatePopulation()` grava o fitness de volta; este caminho não
 *    gravava. Consequência: `getActiveStrategy` ordena por esse campo e não conseguia
 *    ranquear nada, e o baseline do ciclo seguinte voltava a zero.
 *
 * 2. Com baseline zero, `improvement = currentFitness - 0` = o próprio fitness. Como
 *    o limiar era `> 0.02`, QUALQUER rodada abria gate de promoção. Em produção
 *    geraram-se 6 gates, e os que abriram foram justamente os piores resultados
 *    (0.460 e 0.495) — enquanto os melhores de dias antes (0.628) já tinham expirado.
 */
describe('QaScientistService.runExperiment — baseline e promoção', () => {
  function buildService(opts: {
    avgFitness: number
    activeStrategy?: { id: string; systemPrompt: string; fitnessScore: number | null } | null
    melhorMedido?: number
  }) {
    const prisma = {
      benchmarkCase:   { count: jest.fn().mockResolvedValue(5) },
      benchmarkResult: { aggregate: jest.fn().mockResolvedValue({ _max: { fitness: opts.melhorMedido ?? null } }) },
      hypothesis:      { update: jest.fn().mockResolvedValue({}) },
      strategy:        { update: jest.fn().mockResolvedValue({}) },
    }
    const evolutionary = {
      getActiveStrategy: jest.fn().mockResolvedValue(opts.activeStrategy ?? null),
      mutate: jest.fn().mockResolvedValue({ id: 'mutada', systemPrompt: 'prompt mutado' }),
      seed:   jest.fn().mockResolvedValue({ id: 'semeada', systemPrompt: 'prompt semeado' }),
    }
    const benchmark = {
      runForStrategy: jest.fn().mockResolvedValue({ total: 5, skipped: 0, avgFitness: opts.avgFitness, results: [] }),
    }
    const gates = { create: jest.fn().mockResolvedValue({ id: 'gate-1' }) }
    const llm   = { chat: jest.fn() }

    const service = new QaScientistService(
      prisma as never, llm as never, benchmark as never, evolutionary as never, gates as never, { beat: jest.fn() } as never,
    )
    const run = (h: string, t: string, p: string) =>
      (service as unknown as { runExperiment: (h: string, t: string, p: string) => Promise<void> })
        .runExperiment(h, t, p)

    return { service, prisma, evolutionary, benchmark, gates, run }
  }

  it('não grava fitness aqui — quem persiste é runForStrategy, na origem da medição', async () => {
    // Havia cópia própria neste caminho e outra no evaluatePopulation, enquanto quem
    // chamava a rota do benchmark direto não persistia nada. Centralizado.
    const { prisma, run } = buildService({ avgFitness: 0.72 })

    await run('h1', 'summarize', 'p1')

    expect(prisma.strategy.update).not.toHaveBeenCalled()
  })

  it('usa o melhor fitness JÁ MEDIDO como baseline quando não há estratégia ativa', async () => {
    // 0.65 é boa o bastante (>= 0.6), então quem barra aqui é só o baseline: contra
    // 0.645 a melhora é de 0.005. Com o baseline zerado de antes, isso teria virado
    // "+0.65" e aberto gate.
    const { prisma, gates, run } = buildService({ avgFitness: 0.65, melhorMedido: 0.645 })

    await run('h1', 'summarize', 'p1')

    expect(prisma.benchmarkResult.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { case: { taskType: 'summarize' } } }),
    )
    expect(gates.create).not.toHaveBeenCalled()
  })

  it('não propõe promoção de estratégia ruim, mesmo sem baseline nenhum', async () => {
    // O caso real: baseline 0, fitness 0.46, "melhora" de +0.46 — e abria gate.
    const { gates, run } = buildService({ avgFitness: 0.46, melhorMedido: 0 })

    await run('h1', 'summarize', 'p1')

    expect(gates.create).not.toHaveBeenCalled()
  })

  it('propõe promoção quando há melhora real E qualidade acima de 0.6', async () => {
    const { gates, run } = buildService({ avgFitness: 0.71, melhorMedido: 0.5 })

    await run('h1', 'summarize', 'p1')

    expect(gates.create).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'strategy_promotion' }),
    )
  })

  it('cria o gate como high — com medium ele auto-rejeita em 30min sem ninguém ver', async () => {
    // Medido no banco: 5 dos 6 gates de promoção expiraram, nenhum foi visto. TTL de
    // 'medium' é 30 minutos com autoOnExpiry 'reject'; 'high' dá 7 dias e pausa.
    const { gates, run } = buildService({ avgFitness: 0.71, melhorMedido: 0.5 })

    await run('h1', 'summarize', 'p1')

    expect(gates.create).toHaveBeenCalledWith(
      expect.objectContaining({ riskLevel: 'high' }),
    )
  })

  it('compara contra a estratégia ativa quando existe', async () => {
    const { gates, evolutionary, run } = buildService({
      avgFitness: 0.65,
      activeStrategy: { id: 'ativa', systemPrompt: 'prompt ativo', fitnessScore: 0.64 },
    })

    await run('h1', 'summarize', 'p1')

    expect(evolutionary.mutate).toHaveBeenCalledWith('ativa')
    // 0.65 vs 0.64 = +0.01, abaixo do limiar
    expect(gates.create).not.toHaveBeenCalled()
  })
})
