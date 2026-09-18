import { QaScientistService } from '../qa-scientist.service'

/**
 * Escopo de projeto na coleta de sinais do ciclo diário.
 *
 * Achado em 2026-08-07 investigando por que o QA Scientist não produzia hipóteses:
 * o ciclo NÃO estava parado — roda todo dia — mas `v2.project_catalog` só tem um
 * projeto ("Banco Imobiliário Online Caótico"), então é sempre esse que é varrido.
 * Ao ler o collectFailures nessa investigação, apareceu um bug latente: só o sinal
 * de mission step filtrava por projeto. Os resultados de benchmark eram globais —
 * com dois projetos no catálogo, ambos coletariam o mesmo fitness baixo e o ciclo
 * criaria a mesma hipótese duas vezes, uma por projeto.
 *
 * TraceSpan não tem projectId no schema — esse sinal segue global por design.
 */
describe('QaScientistService.collectFailures — escopo por projeto', () => {
  function buildService() {
    const prisma = {
      missionStep:     { findMany: jest.fn().mockResolvedValue([]) },
      benchmarkResult: { findMany: jest.fn().mockResolvedValue([]) },
      traceSpan:       { findMany: jest.fn().mockResolvedValue([]) },
    }
    const service = new QaScientistService(
      prisma as never, {} as never, {} as never, {} as never, {} as never, { beat: jest.fn() } as never,
    )
    const collect = (projectId: string) =>
      (service as unknown as { collectFailures: (p: string) => Promise<unknown[]> }).collectFailures(projectId)
    return { service, prisma, collect }
  }

  it('cada projeto vê SÓ os próprios casos — órfão não conta para ninguém', async () => {
    // A versão anterior aceitava `projectId: null` como sinal legítimo para
    // qualquer projeto. Na prática: 46 casos-semente sem dono, com 36 resultados
    // de fitness baixo, contariam para TODO projeto do catálogo — registrar 7
    // projetos geraria 7 hipóteses idênticas sobre o mesmo fitness.
    // Órfão não some calado: o invariante benchmark_case_tem_dono acusa.
    const { prisma, collect } = buildService()

    await collect('p1')

    expect(prisma.benchmarkResult.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ case: { projectId: 'p1' } }),
      }),
    )
  })

  it('filtra mission steps pelo projeto da missão', async () => {
    const { prisma, collect } = buildService()

    await collect('p1')

    expect(prisma.missionStep.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ mission: { projectId: 'p1' } }),
      }),
    )
  })

  describe('normalizeAnalysis — saída do LLM conferida antes de virar Hypothesis', () => {
    const normalize = (raw: Record<string, unknown>, fallback = 'texto cru') => {
      const { service } = buildService()
      return (service as unknown as {
        normalizeAnalysis: (r: Record<string, unknown>, f: string) => { title: string; analysis: string; taskType: string | null; isPropQualityIssue: boolean }
      }).normalizeAnalysis(raw, fallback)
    }

    it('descarta o taskType quando o modelo copia o placeholder do schema', () => {
      // Aconteceu de verdade: gravou "classify|summarize|context_synthesis|null" como
      // taskType. Não quebra nada visivelmente — runExperiment só não acha caso nenhum
      // e o ciclo desiste calado.
      expect(normalize({ taskType: 'classify|summarize|context_synthesis|null' }).taskType).toBeNull()
    })

    it('aceita os taskTypes conhecidos', () => {
      for (const t of ['classify', 'summarize', 'context_synthesis']) {
        expect(normalize({ taskType: t }).taskType).toBe(t)
      }
    })

    it('descarta taskType desconhecido e null', () => {
      expect(normalize({ taskType: 'inventado' }).taskType).toBeNull()
      expect(normalize({ taskType: null }).taskType).toBeNull()
      expect(normalize({}).taskType).toBeNull()
    })

    it('isPropQualityIssue só é true quando vem booleano true', () => {
      expect(normalize({ isPropQualityIssue: true }).isPropQualityIssue).toBe(true)
      expect(normalize({ isPropQualityIssue: 'true' }).isPropQualityIssue).toBe(false)
      expect(normalize({}).isPropQualityIssue).toBe(false)
    })

    it('trunca o título e cai no fallback quando vem vazio', () => {
      expect(normalize({ title: 'x'.repeat(200) }).title).toHaveLength(80)
      expect(normalize({ title: '   ' }).title).toBe('Análise de falhas recentes')
    })
  })

  it('ignora falha de skill jarvis repetida — é infra, não qualidade de prompt', async () => {
    const { prisma, collect } = buildService()
    prisma.missionStep.findMany.mockResolvedValue([
      { title: 'Ler arquivo', executor: 'ai', status: 'failed', output: { abortReason: 'skill_repeated_failure:jarvis:file_read' } },
      { title: 'Resumir análise', executor: 'ai', status: 'failed', output: { erro: 'json truncado' } },
    ])

    const signals = await collect('p1') as Array<{ detail: string }>

    expect(signals).toHaveLength(1)
    expect(signals[0].detail).toContain('Resumir análise')
  })
})
