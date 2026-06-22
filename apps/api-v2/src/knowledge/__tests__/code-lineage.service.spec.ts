import { CodeLineageService } from '../code-lineage.service'

describe('CodeLineageService.syncFiles', () => {
  function buildService() {
    const nodesById = new Map<string, { id: string; label: string; metadata: object }>()
    let nextId = 0

    const prisma = {
      knowledgeNode: {
        findFirst: jest.fn(({ where }: { where: { label: string } }) => {
          const found = [...nodesById.values()].find((n) => n.label === where.label)
          return Promise.resolve(found ?? null)
        }),
        create: jest.fn(({ data }: { data: { label: string; metadata: object } }) => {
          const node = { id: `n${nextId++}`, label: data.label, metadata: data.metadata }
          nodesById.set(node.id, node)
          return Promise.resolve(node)
        }),
        update: jest.fn(({ where, data }: { where: { id: string }; data: { metadata: object } }) => {
          const node = nodesById.get(where.id)!
          node.metadata = data.metadata
          return Promise.resolve(node)
        }),
      },
      knowledgeEdge: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        create: jest.fn().mockResolvedValue({}),
      },
    }
    return { service: new CodeLineageService(prisma as never), prisma }
  }

  it('cria um node por arquivo e um edge depende_de por import resolvido', async () => {
    const { service, prisma } = buildService()

    const result = await service.syncFiles(
      'p1',
      [{ path: 'a.ts' }, { path: 'b.ts' }],
      [{ from: 'a.ts', to: 'b.ts' }],
    )

    expect(result).toEqual({ nodes: 2, edges: 1 })
    expect(prisma.knowledgeEdge.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ projectId: 'p1', relation: 'depende_de', source: 'extracted' }),
    })
  })

  it('ignora edge cujo destino não está no batch de arquivos (import externo não resolvido)', async () => {
    const { service } = buildService()

    const result = await service.syncFiles(
      'p1',
      [{ path: 'a.ts' }],
      [{ from: 'a.ts', to: 'pacote-externo-npm' }],
    )

    expect(result.edges).toBe(0)
  })

  it('apaga os edges depende_de antigos do projeto antes de recriar (full-replace, evita staleness)', async () => {
    const { service, prisma } = buildService()

    await service.syncFiles('p1', [{ path: 'a.ts' }], [])

    expect(prisma.knowledgeEdge.deleteMany).toHaveBeenCalledWith({
      where: { projectId: 'p1', relation: 'depende_de' },
    })
  })

  it('reaproveita o node existente (update) em vez de duplicar quando o arquivo já foi sincronizado antes', async () => {
    const { service, prisma } = buildService()

    await service.syncFiles('p1', [{ path: 'a.ts', isRoute: false }], [])
    await service.syncFiles('p1', [{ path: 'a.ts', isRoute: true, routePrefix: '/qa' }], [])

    expect(prisma.knowledgeNode.create).toHaveBeenCalledTimes(1)
    expect(prisma.knowledgeNode.update).toHaveBeenCalledTimes(1)
  })
})

describe('CodeLineageService.impactFromFile', () => {
  function buildServiceWithGraph(
    nodes: Array<{ id: string; label: string; metadata?: object }>,
    edges: Array<{ fromId: string; toId: string }>,
  ) {
    const nodeById = new Map(nodes.map((n) => [n.id, { ...n, metadata: n.metadata ?? {} }]))

    const prisma = {
      knowledgeNode: {
        findFirst: jest.fn(({ where }: { where: { label: string } }) =>
          Promise.resolve([...nodeById.values()].find((n) => n.label === where.label) ?? null),
        ),
      },
      knowledgeEdge: {
        findMany: jest.fn(({ where }: { where: { toId: { in: string[] } } }) => {
          const matched = edges.filter((e) => where.toId.in.includes(e.toId))
          return Promise.resolve(matched.map((e) => ({ ...e, from: nodeById.get(e.fromId) })))
        }),
      },
    }
    return new CodeLineageService(prisma as never)
  }

  it('retorna found:false quando o arquivo não está sincronizado', async () => {
    const service = buildServiceWithGraph([], [])
    const result = await service.impactFromFile('p1', 'nao-existe.ts')

    expect(result.found).toBe(false)
    expect(result.totalImpacted).toBe(0)
  })

  it('acha quem depende do arquivo (1 nível) e marca isRoute quando aplicável', async () => {
    const service = buildServiceWithGraph(
      [
        { id: 'shared', label: 'shared.ts' },
        { id: 'controller', label: 'qa.controller.ts', metadata: { isRoute: true, routePrefix: '/qa' } },
      ],
      [{ fromId: 'controller', toId: 'shared' }],
    )

    const result = await service.impactFromFile('p1', 'shared.ts')

    expect(result.found).toBe(true)
    expect(result.totalImpacted).toBe(1)
    expect(result.impactedRoutes).toEqual([
      expect.objectContaining({ path: 'qa.controller.ts', routePrefix: '/qa' }),
    ])
  })

  it('segue a cadeia transitivamente até maxDepth (A depende de B depende de arquivo raiz)', async () => {
    const service = buildServiceWithGraph(
      [
        { id: 'root', label: 'root.ts' },
        { id: 'mid', label: 'mid.ts' },
        { id: 'top', label: 'top.controller.ts', metadata: { isRoute: true } },
      ],
      [
        { fromId: 'mid', toId: 'root' },
        { fromId: 'top', toId: 'mid' },
      ],
    )

    const result = await service.impactFromFile('p1', 'root.ts', 5)

    expect(result.impactedFiles.map((n) => n.path)).toEqual(['mid.ts', 'top.controller.ts'])
    expect(result.impactedFiles.find((n) => n.path === 'top.controller.ts')?.depth).toBe(2)
  })

  it('não entra em loop infinito quando há ciclo de dependência', async () => {
    const service = buildServiceWithGraph(
      [
        { id: 'a', label: 'a.ts' },
        { id: 'b', label: 'b.ts' },
      ],
      [
        { fromId: 'b', toId: 'a' },
        { fromId: 'a', toId: 'b' },
      ],
    )

    const result = await service.impactFromFile('p1', 'a.ts', 10)

    expect(result.totalImpacted).toBe(1)
    expect(result.impactedFiles[0].path).toBe('b.ts')
  })
})
