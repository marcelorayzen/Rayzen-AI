import { HubWorkItemService, entregaPublica } from '../hub-work-item.service'

describe('entregaPublica — o cartão recebe só o que precisa', () => {
  const base = {
    branch: 'rayzen/sessao-cmsessao', commit: 'c'.repeat(40), publicado: true,
    remoto: 'https://usuario:ghp_segredo@github.com/x/y.git',
    prUrl: 'https://github.com/x/y/pull/4', prEstado: 'OPEN', prRascunho: true, medidoEm: '2026-11-12T10:00:00Z',
  }

  it('projeta branch, commit e PR — e nunca o remoto, que pode carregar credencial', () => {
    const e = entregaPublica(base)
    expect(e).toEqual({
      branch: base.branch, commit: base.commit, publicado: true, prUrl: base.prUrl,
      prEstado: 'OPEN', prRascunho: true, medidoEm: base.medidoEm,
    })
    expect(JSON.stringify(e)).not.toContain('ghp_segredo')
  })

  it.each([
    'javascript:alert(1)', 'https://evil.example/x/y/pull/4', 'http://github.com/x/y/pull/4',
    'https://github.com/x/y/pull/4?next=evil', 'https://github.com.evil.io/x/y/pull/4',
  ])('descarta link de PR fora do formato GitHub: %s', (prUrl) => {
    expect(entregaPublica({ ...base, prUrl })?.prUrl).toBeNull()
  })

  it('sem entrega (ou malformada) é null, não cartão vazio', () => {
    expect(entregaPublica(null)).toBeNull()
    expect(entregaPublica({ branch: 'x' })).toBeNull()
    expect(entregaPublica('texto')).toBeNull()
  })
})

describe('HubWorkItemService — H5 read-only projection', () => {
  it('lista somente as referências do fio resolvido para o principal e escopo', async () => {
    const findMany = jest.fn().mockResolvedValue([{ id: 'item-1', sourceId: 'handoff-1' }])
    const resolveActive = jest.fn().mockResolvedValue({ id: 'thread-project-a' })
    const service = new HubWorkItemService(
      { hubWorkItem: { findMany } } as never,
      { resolveActive } as never,
    )

    await expect(service.list('marcelo', 'project-a')).resolves.toEqual([{ id: 'item-1', sourceId: 'handoff-1' }])
    expect(resolveActive).toHaveBeenCalledWith('marcelo', 'project-a')
    expect(findMany).toHaveBeenCalledWith({
      where: { threadId: 'thread-project-a' }, orderBy: { createdAt: 'desc' }, take: 100,
    })
  })

  it('vincula uma referência real de forma idempotente no fio humano', async () => {
    const upsert = jest.fn().mockResolvedValue({ id: 'item-1' })
    const findFirst = jest.fn().mockResolvedValue({ id: 'handoff-1' })
    const resolveActive = jest.fn().mockResolvedValue({ id: 'thread-project-a' })
    const service = new HubWorkItemService({ hubWorkItem: { upsert }, projectHandoff: { findFirst } } as never, { resolveActive } as never)
    await service.link('marcelo', 'project-a', { kind: 'project_handoff', sourceSystem: 'v1', sourceId: 'handoff-1' })
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { threadId_sourceSystem_sourceId: { threadId: 'thread-project-a', sourceSystem: 'v1', sourceId: 'handoff-1' } },
    }))
  })

  it('refuses a missing or cross-project handoff before resolving the thread', async () => {
    const findFirst = jest.fn().mockResolvedValue(null)
    const resolveActive = jest.fn()
    const service = new HubWorkItemService({ projectHandoff: { findFirst } } as never, { resolveActive } as never)

    await expect(service.link('marcelo', 'project-a', { kind: 'project_handoff', sourceSystem: 'v1', sourceId: 'other-project-handoff' })).rejects.toMatchObject({ response: { code: 'hub_handoff_not_found' } })
    await expect(service.link('marcelo', 'project-a', { kind: 'mission', sourceSystem: 'v2', sourceId: 'mission-1' })).rejects.toMatchObject({ response: { code: 'hub_work_item_source_unsupported' } })
    expect(resolveActive).not.toHaveBeenCalled()
  })

  it('reconcilia apenas handoffs do projeto pedido que ainda não têm vínculo', async () => {
    const findManyWork = jest.fn().mockResolvedValue([{ sourceId: 'handoff-ja-vinculado' }])
    const findManyHandoff = jest.fn().mockResolvedValue([{ id: 'handoff-pendente', status: 'awaiting_approval' }])
    const service = new HubWorkItemService(
      { hubWorkItem: { findMany: findManyWork }, projectHandoff: { findMany: findManyHandoff } } as never,
      {} as never,
    )
    await expect(service.unlinkedHandoffs('project-a')).resolves.toEqual([{ id: 'handoff-pendente', status: 'awaiting_approval' }])
    expect(findManyHandoff).toHaveBeenCalledWith(expect.objectContaining({
      where: { sourceProjectId: 'project-a', id: { notIn: ['handoff-ja-vinculado'] } },
    }))
  })

  it('projects only linked handoffs for the current project without copying their lifecycle', async () => {
    const linkedAt = new Date('2026-10-18T20:00:00Z')
    const findManyWork = jest.fn().mockResolvedValue([{ id: 'item-1', sourceId: 'handoff-1', createdAt: linkedAt }])
    const findManyHandoff = jest.fn().mockResolvedValue([{ id: 'handoff-1', name: 'Real handoff', status: 'queued' }])
    const resolveActive = jest.fn().mockResolvedValue({ id: 'thread-project-a' })
    const service = new HubWorkItemService(
      { hubWorkItem: { findMany: findManyWork }, projectHandoff: { findMany: findManyHandoff } } as never,
      { resolveActive } as never,
    )

    await expect(service.linkedHandoffs('marcelo', 'project-a')).resolves.toEqual([
      { id: 'item-1', sourceId: 'handoff-1', linkedAt, handoff: { id: 'handoff-1', name: 'Real handoff', status: 'queued', entrega: null } },
    ])
    expect(findManyHandoff).toHaveBeenCalledWith(expect.objectContaining({
      where: { sourceProjectId: 'project-a', id: { in: ['handoff-1'] } },
    }))
  })
})

describe('HubWorkItemService.abrirEntrega — o branch vem da entrega confirmada, nunca do cliente', () => {
  const entrega = {
    branch: 'rayzen/sessao-cmsessao', commit: 'c'.repeat(40), publicado: true,
    prUrl: 'https://github.com/x/y/pull/4', prEstado: 'OPEN', prRascunho: true, medidoEm: 'x',
  }
  function montar(handoff: Record<string, unknown> | null, item: Record<string, unknown> | null = { id: 'item-1', sourceId: 'h1' }) {
    const prisma = {
      hubWorkItem: { findFirst: jest.fn().mockResolvedValue(item) },
      projectHandoff: { findFirst: jest.fn().mockResolvedValue(handoff) },
    }
    const threads = { resolveActive: jest.fn().mockResolvedValue({ id: 'thread-a' }) }
    const execution = { dispatch: jest.fn().mockResolvedValue({ path: 'C:/p.entregas/sessao-cmsessao', reutilizado: false }) }
    return { service: new HubWorkItemService(prisma as never, threads as never, execution as never), prisma, execution }
  }

  it('despacha open_delivery com o branch gravado e o projeto do envelope', async () => {
    const { service, prisma, execution } = montar({ id: 'h1', status: 'completed', projectId: 'proj-alvo', delivery: entrega })
    await service.abrirEntrega('marcelo', 'project-a', 'item-1')
    expect(prisma.hubWorkItem.findFirst).toHaveBeenCalledWith({
      where: { id: 'item-1', threadId: 'thread-a', kind: 'project_handoff', sourceSystem: 'v1' },
    })
    expect(execution.dispatch).toHaveBeenCalledWith('open_delivery', { projectId: 'proj-alvo', branch: 'rayzen/sessao-cmsessao' })
  })

  it('item de outro fio (ou inexistente) é 404 e nada é despachado', async () => {
    const { service, execution } = montar(null, null)
    await expect(service.abrirEntrega('marcelo', 'project-a', 'item-x')).rejects.toMatchObject({ response: { code: 'hub_work_item_not_found' } })
    expect(execution.dispatch).not.toHaveBeenCalled()
  })

  it.each([
    ['envelope não concluído', { id: 'h1', status: 'reconciling', projectId: 'p', delivery: entrega }],
    ['sem entrega gravada', { id: 'h1', status: 'completed', projectId: 'p', delivery: null }],
    ['handoff de outro projeto', null],
  ])('%s: 409 sem despacho', async (_caso, handoff) => {
    const { service, execution } = montar(handoff)
    await expect(service.abrirEntrega('marcelo', 'project-a', 'item-1')).rejects.toMatchObject({ response: { code: 'hub_delivery_unavailable' } })
    expect(execution.dispatch).not.toHaveBeenCalled()
  })
})
