import { HubThreadService } from '../hub-thread.service'
import { PROJETO_GERAL_ID } from '../../../common/escopo-geral.const'

describe('HubThreadService — H1 projeção por principal e escopo', () => {
  const makeService = () => {
    const upsert = jest.fn(async (args: { create: Record<string, unknown>; where: unknown }) => ({
      id: 'thread-1', ...args.create, hermesSessionId: null, status: 'active',
    }))
    return { service: new HubThreadService({ hubThread: { upsert } } as never), upsert }
  }

  it('normaliza Geral em chave própria, sem usar NULL como curinga', async () => {
    const { service, upsert } = makeService()
    await service.resolveActive('admin', null)

    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { principalId_scopeKey: { principalId: 'admin', scopeKey: 'general' } },
      create: expect.objectContaining({ scopeType: 'general', projectId: PROJETO_GERAL_ID }),
    }))
  })

  it('isola projeto por principal e não mistura os IDs de projeto', async () => {
    const { service, upsert } = makeService()
    await service.resolveActive('admin', 'project-A')
    await service.resolveActive('admin', 'project-B')

    expect(upsert.mock.calls[0][0].where).toEqual({ principalId_scopeKey: { principalId: 'admin', scopeKey: 'project-A' } })
    expect(upsert.mock.calls[1][0].where).toEqual({ principalId_scopeKey: { principalId: 'admin', scopeKey: 'project-B' } })
  })

  it('não permite que outro principal retome o fio de quem iniciou', async () => {
    const { service, upsert } = makeService()
    await service.resolveActive('principal-A', 'project-A')
    await service.resolveActive('principal-B', 'project-A')

    expect(upsert.mock.calls[0][0].where).not.toEqual(upsert.mock.calls[1][0].where)
  })
})
