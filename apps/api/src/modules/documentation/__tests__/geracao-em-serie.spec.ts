import { DocumentationService } from '../documentation.service'

/**
 * Os quatro documentos partiam em PARALELO (`Promise.allSettled`), e cada um carrega um
 * rollup de 30 dias. Quatro prompts grandes no mesmo segundo estouram o limite de TOKENS
 * POR MINUTO do free tier — nao o de requisicoes. Dai o sintoma ser 429 em rajada.
 *
 * Medido em 2026-09-08, 36h, ja descontada a sonda: `rayzen:v1:documentation` fez 68
 * chamadas a `gpt-4o-mini` e 40 falharam, todas por cota. A sonda, no MESMO grupo e na
 * MESMA janela, fez 86 chamadas com zero erro — o provedor estava bem.
 */
describe('generateAll — geração em série', () => {
  function build() {
    const emVoo: number[] = []
    let concorrentesMax = 0
    let ativos = 0

    const svc = new DocumentationService(
      { projectState: { findUnique: jest.fn().mockResolvedValue({ updatedAt: new Date() }) } } as never,
      { get: jest.fn() } as never,
      { refresh: jest.fn() } as never,
      { llmTokensTotal: { inc: jest.fn() }, llmRequestDuration: { observe: jest.fn() } } as never,
    )

    jest.spyOn(svc, 'generate').mockImplementation(async (_p, type) => {
      ativos++
      concorrentesMax = Math.max(concorrentesMax, ativos)
      emVoo.push(ativos)
      await new Promise((r) => setTimeout(r, 5))
      ativos--
      return { id: 'x', type: String(type), content: '', generatedAt: new Date().toISOString() }
    })

    return { svc, pico: () => concorrentesMax }
  }

  it('nunca há mais de uma geração em voo', async () => {
    const { svc, pico } = build()
    await svc.generateAll('p1')
    expect(pico()).toBe(1)
  })

  it('gera os cinco tipos, na ordem declarada', async () => {
    const { svc } = build()
    const r = await svc.generateAll('p1')
    expect(r.map((x) => x.type)).toEqual(
      ['project_state', 'decisions_log', 'next_actions', 'work_journal', 'test_evidence'],
    )
  })

  /** Um tipo que falha nao pode interromper os outros — era o que o allSettled garantia. */
  it('um tipo que falha não interrompe os demais', async () => {
    const { svc } = build()
    jest.spyOn(svc, 'generate').mockImplementation(async (_p, type) => {
      if (type === 'decisions_log') throw new Error('429 cota')
      return { id: 'x', type: String(type), content: '', generatedAt: new Date().toISOString() }
    })

    const r = await svc.generateAll('p1')

    expect(r).toHaveLength(5)
    expect(r.filter((x) => x.ok)).toHaveLength(4)
    expect(r.find((x) => x.type === 'decisions_log')).toMatchObject({ ok: false, error: '429 cota' })
  })
})
