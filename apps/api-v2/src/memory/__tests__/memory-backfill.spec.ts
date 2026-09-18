import { MemoryService } from '../memory.service'

/**
 * Em 2026-08-16: 3.816 documentos no Brain, 19 com ciclo de vida — e as 19 eram
 * artefatos de missão de junho. Os 20 aprendizados capturados por
 * `rayzen_capture_learning` tinham ZERO.
 *
 * Consequência medida: caíam no default `inbox`, e em modo `architecture` o boost
 * de `inbox` é 0 contra +0.20 de `consolidated`. As decisões rankeavam abaixo de
 * tudo exatamente no modo onde decisão importa mais.
 *
 * A alternativa descartada foi o MCP chamar uma segunda rota após capturar —
 * wiring que depende de alguém lembrar, que é a falha do `setCostController()`.
 */
describe('MemoryService.backfillLifecycle', () => {
  function build(docs: Array<Record<string, unknown>>, jaTem: string[] = []) {
    const prisma = {
      memoryMeta: {
        findMany: jest.fn().mockResolvedValue(jaTem.map((v1DocumentId) => ({ v1DocumentId }))),
        create:   jest.fn().mockResolvedValue({}),
      },
    }
    const v1Api  = { indexContent: jest.fn() }
    const bridge = { listLearningDocuments: jest.fn().mockResolvedValue(docs) }
    const system = { beat: jest.fn().mockResolvedValue(undefined) }
    return {
      service: new MemoryService(prisma as never, v1Api as never, bridge as never, system as never),
      prisma, bridge, system,
    }
  }

  const doc = (id: string, learningType?: string, projectId = 'p1') => ({
    id, projectId, sourcePath: `learning/${id}`,
    metadata: learningType ? { learningType } : {},
  })

  it('decisão vira memoryType decision e nasce consolidated', async () => {
    const { service, prisma } = build([doc('d1', 'decision')])

    await expect(service.backfillLifecycle()).resolves.toBe(1)
    expect(prisma.memoryMeta.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        v1DocumentId: 'd1',
        memoryType:   'decision',
        // Em `inbox` uma decisão competiria por relevância com anotação solta.
        memoryClass:  'consolidated',
      }),
    })
  })

  it('gotcha e troubleshooting viram lesson, e ficam em inbox', async () => {
    const { service, prisma } = build([doc('d1', 'gotcha'), doc('d2', 'troubleshooting')])

    await service.backfillLifecycle()

    const tipos = prisma.memoryMeta.create.mock.calls.map((c) => c[0].data)
    expect(tipos.every((t) => t.memoryType === 'lesson')).toBe(true)
    expect(tipos.every((t) => t.memoryClass === 'inbox')).toBe(true)
  })

  it('runbook vira pattern — procedimento repetível', async () => {
    const { service, prisma } = build([doc('d1', 'runbook')])
    await service.backfillLifecycle()
    expect(prisma.memoryMeta.create.mock.calls[0][0].data.memoryType).toBe('pattern')
  })

  it('tipo desconhecido NÃO é chutado — entra sem memoryType e é contado', async () => {
    // Chutar o tipo seria pior que não ter: o boost por tipo passaria a mentir.
    const { service, prisma, system } = build([doc('d1', 'tipo-que-ninguem-cadastrou')])

    await service.backfillLifecycle()

    expect(prisma.memoryMeta.create.mock.calls[0][0].data.memoryType).toBeUndefined()
    expect(system.beat).toHaveBeenCalledWith('memory-backfill',
      expect.objectContaining({ detalhe: { criados: 1, semTipo: 1 } }))
  })

  it('não recria o que já tem ciclo de vida', async () => {
    const { service, prisma } = build([doc('d1', 'decision'), doc('d2', 'gotcha')], ['d1'])

    await expect(service.backfillLifecycle()).resolves.toBe(1)
    expect(prisma.memoryMeta.create).toHaveBeenCalledTimes(1)
  })

  it('documento sem projeto é pulado — ciclo de vida é escopado por projeto', async () => {
    const { service, prisma } = build([{ ...doc('d1', 'decision'), projectId: null }])

    await expect(service.backfillLifecycle()).resolves.toBe(0)
    expect(prisma.memoryMeta.create).not.toHaveBeenCalled()
  })

  it('falha bate com ok:false e preserva o erro', async () => {
    const { service, system, bridge } = build([])
    bridge.listLearningDocuments.mockRejectedValue(new Error('V1 fora'))

    await expect(service.backfillLifecycle()).resolves.toBe(0)
    expect(system.beat).toHaveBeenCalledWith('memory-backfill',
      expect.objectContaining({ ok: false, erro: 'V1 fora' }))
  })
})
