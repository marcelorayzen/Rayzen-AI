import { GraphService, GapAnalysis } from '../graph.service'

/**
 * `getGoalGraph` chamava `analyzeGap` — uma chamada de LLM de ~60s — em TODA requisição.
 * Medido em 19/08: 64,7s · 0,034s · 0,010s. Os milissegundos das chamadas seguintes vinham
 * do cache do LiteLLM (ttl 300s), cuja chave embute o ProjectState — ou seja, ele errava
 * exatamente quando alguém estava trabalhando. Na tela isso era o painel do grafo parado
 * em "Carregando…", sem erro e sem timeout.
 *
 * A análise já era gravada em `lastGapAnalysis` e **nunca lida**. Agora serve-se o valor
 * gravado e recalcula-se fora do caminho da resposta.
 */
describe('GraphService.getGoalGraph — a gap analysis sai do caminho da resposta', () => {
  const ANALISE: GapAnalysis = {
    gaps: [{ area: 'focus', description: 'algo', severity: 'low' } as never],
    nextBestAction: 'seguir',
    goalProgress: 50,
    confidence: 'medium',
  }

  function build(lastGapAnalysis: unknown) {
    const goal = {
      id: 'g1', projectId: 'p1', title: 'Meta', successCriteria: [], kpis: [],
      targetDate: null, lastGapAnalysis,
    }
    const prisma = {
      projectGoal: {
        findFirst:  jest.fn().mockResolvedValue(goal),
        findUnique: jest.fn().mockResolvedValue(goal),
        update:     jest.fn().mockResolvedValue(goal),
      },
      event: { findMany: jest.fn().mockResolvedValue([]) },
    }
    const stateService = { get: jest.fn().mockResolvedValue({ milestones: [], nextSteps: [], blockers: [], risks: [] }) }
    const healthService = { getCurrent: jest.fn().mockResolvedValue({ score: 90 }) }

    const service = new GraphService(
      prisma as never, stateService as never, healthService as never,
      { get: jest.fn() } as never, {} as never, {} as never,
    )
    // O custo que este conserto existe para tirar do caminho.
    const analyzeGap = jest.spyOn(service as never, 'analyzeGap' as never)
      .mockResolvedValue(ANALISE as never)

    return { service, prisma, analyzeGap }
  }

  const agora = () => new Date().toISOString()
  const minutosAtras = (m: number) => new Date(Date.now() - m * 60_000).toISOString()

  it('com análise gravada e fresca, responde SEM chamar o LLM', async () => {
    const { service, analyzeGap } = build({ ...ANALISE, analyzedAt: agora() })

    const r = await service.getGoalGraph('p1')

    expect(analyzeGap).not.toHaveBeenCalled()
    expect(r.gapAnalysis).toMatchObject({ nextBestAction: 'seguir', goalProgress: 50 })
    expect(r.gapAnalysisAt).toBeTruthy()
  })

  it('sem análise gravada, calcula uma vez e grava com a data dentro do JSON', async () => {
    const { service, prisma, analyzeGap } = build(null)

    const r = await service.getGoalGraph('p1')

    expect(analyzeGap).toHaveBeenCalledTimes(1)
    expect(r.gapAnalysis).toMatchObject({ nextBestAction: 'seguir' })

    const gravado = prisma.projectGoal.update.mock.calls[0][0].data.lastGapAnalysis
    // A data mora DENTRO do JSON: `updatedAt` da meta é @updatedAt e já responde por toda
    // escrita — usá-lo como idade repetiria o erro que motivou o contentChangedAt.
    expect(gravado.analyzedAt).toBeTruthy()
    expect(gravado.nextBestAction).toBe('seguir')
  })

  it('com análise velha, responde NA HORA com o valor gravado e recalcula em background', async () => {
    const velha = { ...ANALISE, nextBestAction: 'valor antigo', analyzedAt: minutosAtras(30) }
    const { service, analyzeGap } = build(velha)

    const r = await service.getGoalGraph('p1')

    // a resposta não esperou o recálculo
    expect(r.gapAnalysis).toMatchObject({ nextBestAction: 'valor antigo' })

    await new Promise((resolve) => setImmediate(resolve))
    expect(analyzeGap).toHaveBeenCalled()
  })

  it('N requisições simultâneas sobre análise velha disparam UM recálculo, não N', async () => {
    const { service, analyzeGap } = build({ ...ANALISE, analyzedAt: minutosAtras(30) })

    await Promise.all([service.getGoalGraph('p1'), service.getGoalGraph('p1'), service.getGoalGraph('p1')])
    await new Promise((resolve) => setImmediate(resolve))

    expect(analyzeGap).toHaveBeenCalledTimes(1)
  })

  it('análise gravada antes do campo de data existir é recalculada', async () => {
    const { service, analyzeGap } = build({ ...ANALISE })   // sem analyzedAt

    const r = await service.getGoalGraph('p1')
    expect(r.gapAnalysis).toBeTruthy()          // ainda assim responde na hora

    await new Promise((resolve) => setImmediate(resolve))
    expect(analyzeGap).toHaveBeenCalled()
  })

  it('falha no recálculo em background não afeta a resposta já enviada', async () => {
    const { service, analyzeGap } = build({ ...ANALISE, analyzedAt: minutosAtras(30) })
    analyzeGap.mockRejectedValue(new Error('llm indisponível') as never)

    const r = await service.getGoalGraph('p1')

    expect(r.gapAnalysis).toMatchObject({ nextBestAction: 'seguir' })
    await new Promise((resolve) => setImmediate(resolve))
    // sem unhandled rejection e sem exceção vazando para o chamador
  })
})
