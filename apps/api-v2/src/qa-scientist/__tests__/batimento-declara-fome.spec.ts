import { QaScientistService } from '../qa-scientist.service'

/**
 * O batimento do QA Scientist precisa distinguir "quieto porque tudo vai bem" de
 * "quieto porque ninguém liga mais na entrada".
 *
 * Medido em 2026-09-06: o batimento dizia `{ ciclos: 10 }` com `ok: true` todo dia
 * desde 24/08, e nesse mesmo intervalo o ciclo não produziu **uma** hipótese nem
 * **uma** chamada de LLM. As três fontes de `collectFailures` estavam vazias por
 * motivos estruturais — o executor de missões está congelado por decisão de produto,
 * `benchmark_results` só é alimentado por este mesmo ciclo (fome circular), e
 * `trace_spans` nunca teve uma linha sequer.
 *
 * O sinal de "vivo" e o sinal de "desligado" eram byte a byte iguais. Foi assim que
 * `v2.cost_records` parou de crescer em 24/08 sem que nada acusasse: quem gravava
 * custo era justamente este ciclo.
 */
describe('QaScientistService — o batimento declara a fome', () => {
  function buildService(porProjeto: (id: string) => { hypothesisId: string | null; reason: string }) {
    const beat = jest.fn()
    const prisma = {
      projectCatalog: {
        findMany: jest.fn().mockResolvedValue([
          { v1ProjectId: 'p1' }, { v1ProjectId: 'p2' }, { v1ProjectId: 'p3' },
        ]),
      },
    }
    const service = new QaScientistService(
      prisma as never, {} as never, {} as never, {} as never, {} as never, { beat } as never,
    )
    jest.spyOn(service, 'dailyCycle').mockImplementation(async (id: string) => {
      const r = porProjeto(id)
      return { ...r, skipped: r.hypothesisId === null }
    })
    return { service, beat }
  }

  const detalhe = (beat: jest.Mock) => beat.mock.calls[0][1].detalhe as Record<string, number>

  it('varrer 3 projetos sem sinal nenhum aparece como semSinal, não só como ciclos', async () => {
    const { service, beat } = buildService(() => ({ hypothesisId: null, reason: 'no_failures' }))

    await service.runForAllProjects()

    // `ciclos: 3` sozinho é indistinguível de um ciclo produtivo — era exatamente o
    // que o painel mostrava enquanto nada acontecia.
    expect(detalhe(beat)).toEqual({ ciclos: 3, semSinal: 3, hipoteses: 0 })
    expect(beat.mock.calls[0][1].ok).toBe(true)
  })

  it('ciclo que produz hipótese conta em hipoteses — o contraste é o que dá sentido ao zero', async () => {
    const { service, beat } = buildService((id) =>
      id === 'p2'
        ? { hypothesisId: 'h1', reason: 'cycle_complete' }
        : { hypothesisId: null, reason: 'no_failures' },
    )

    await service.runForAllProjects()

    expect(detalhe(beat)).toEqual({ ciclos: 3, semSinal: 2, hipoteses: 1 })
  })

  /**
   * Projeto que explode não é projeto sem sinal: um vira "conserte a coleta", o outro
   * vira "não há o que analisar". Somá-los devolveria a ambiguidade que este detalhe
   * existe para eliminar.
   */
  it('projeto que lança não entra em semSinal', async () => {
    const beat = jest.fn()
    const prisma = {
      projectCatalog: { findMany: jest.fn().mockResolvedValue([{ v1ProjectId: 'p1' }, { v1ProjectId: 'p2' }]) },
    }
    const service = new QaScientistService(
      prisma as never, {} as never, {} as never, {} as never, {} as never, { beat } as never,
    )
    jest.spyOn(service, 'dailyCycle').mockImplementation(async (id: string) => {
      if (id === 'p1') throw new Error('prisma caiu')
      return { hypothesisId: null, skipped: true, reason: 'no_failures' }
    })

    await service.runForAllProjects()

    expect(detalhe(beat)).toEqual({ ciclos: 2, semSinal: 1, hipoteses: 0 })
  })
})
