import { CatalogService } from '../catalog.service'

/**
 * O catálogo só era preenchido por chamada explícita de API. Como o QA Scientist
 * e os invariantes varrem o `project_catalog` — não a lista de projetos da V1 —
 * um projeto novo nascia invisível para a V2. O Rayzen AI ficou **dois meses**
 * fora do catálogo: o ciclo rodava todo dia, sobre nada, sem erro nenhum.
 *
 * O invariante `projeto_ativo_no_catalogo` passou a detectar isso, mas detectar
 * não é funcionar — alguém ainda precisava ler o aviso e agir.
 */
describe('CatalogService.syncNovosProjetos', () => {
  function build(v1: Array<{ id: string; name: string }>, noCatalogo: string[]) {
    const prisma = {
      projectCatalog: {
        findMany: jest.fn().mockResolvedValue(noCatalogo.map((v1ProjectId) => ({ v1ProjectId }))),
        create:   jest.fn().mockResolvedValue({}),
      },
    }
    const bridge = { listProjects: jest.fn().mockResolvedValue(v1) }
    // SystemStatusService: o beat e contabilidade, nao comportamento sob teste.
    const system = { beat: jest.fn().mockResolvedValue(undefined) }
    return { service: new CatalogService(prisma as never, bridge as never, system as never), prisma, bridge, system }
  }

  it('registra só o que falta', async () => {
    const { service, prisma } = build(
      [{ id: 'p1', name: 'Rayzen AI' }, { id: 'p2', name: 'Projeto Novo' }],
      ['p1'],
    )

    await expect(service.syncNovosProjetos()).resolves.toBe(1)
    expect(prisma.projectCatalog.create).toHaveBeenCalledTimes(1)
    expect(prisma.projectCatalog.create).toHaveBeenCalledWith({
      data: { v1ProjectId: 'p2', provenance: 'auto', tags: [] },
    })
  })

  it('não toca em entrada existente — owner e tags são curadoria humana', async () => {
    const { service, prisma } = build([{ id: 'p1', name: 'Rayzen AI' }], ['p1'])

    await expect(service.syncNovosProjetos()).resolves.toBe(0)
    expect(prisma.projectCatalog.create).not.toHaveBeenCalled()
  })

  it('não filtra por status: a ponte já devolve só os ativos', async () => {
    // Repetir o filtro aqui daria a impressão de uma garantia que mora na ponte.
    const { service, bridge } = build([{ id: 'p1', name: 'X' }], [])
    await service.syncNovosProjetos()
    expect(bridge.listProjects).toHaveBeenCalledTimes(1)
  })

  it('banco fora do ar não derruba o ciclo', async () => {
    const { service } = build([], [])
    ;(service as unknown as { bridge: { listProjects: jest.Mock } }).bridge.listProjects
      .mockRejectedValue(new Error('sem banco'))

    await expect(service.syncNovosProjetos()).resolves.toBe(0)
  })

  it('onModuleInit respeita CATALOG_SYNC_ENABLED=false', () => {
    const anterior = process.env.CATALOG_SYNC_ENABLED
    process.env.CATALOG_SYNC_ENABLED = 'false'
    const { service } = build([], [])

    service.onModuleInit()
    expect((service as unknown as { warmupTimer: unknown }).warmupTimer).toBeNull()

    process.env.CATALOG_SYNC_ENABLED = anterior
    service.onModuleDestroy()
  })
})
