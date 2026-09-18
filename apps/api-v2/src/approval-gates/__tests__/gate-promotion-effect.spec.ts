import { ApprovalGatesService } from '../approval-gates.service'

/**
 * Aprovar um gate precisa FAZER a coisa, não só mudar o status.
 *
 * Achado em produção em 2026-08-12: o gate 1283c977 estava `approved` — "promover
 * d3cc9a40 para summarize" — e a estratégia continuava `candidate`, com `promoted_at`
 * null. `EvolutionaryService.promote()` existia e fazia o certo, mas nada o chamava:
 * `approve()` só virava o status e retornava.
 *
 * Falha em silêncio: o estado "aprovado" fica indistinguível de "aprovado e aplicado",
 * tanto no banco quanto na UI. Mesma classe do bug do motor de missões, em que gate
 * aprovado nunca executava de fato.
 */
describe('ApprovalGatesService.approve — o efeito da aprovação', () => {
  function buildService(gate: { id: string; type: string; context: unknown; status?: string }) {
    const prisma = {
      approvalGate: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn().mockResolvedValue({ status: 'approved', ...gate }),
      },
    }
    const events   = { emit: jest.fn(), broadcast: jest.fn() }
    const missions = {}
    const service  = new ApprovalGatesService(prisma as never, events as never, missions as never)
    const promote  = jest.fn().mockResolvedValue({})
    return { service, prisma, promote }
  }

  it('promove a estratégia quando um gate strategy_promotion é aprovado', async () => {
    const { service, promote } = buildService({
      id: 'g1', type: 'strategy_promotion',
      context: { strategyId: 'strat-1', taskType: 'summarize' },
    })
    service.setEvolutionary({ promote })

    await service.approve('g1', 'marcelo')

    expect(promote).toHaveBeenCalledWith('strat-1')
  })

  it('não promove nada em gate de outro tipo', async () => {
    const { service, promote } = buildService({
      id: 'g2', type: 'data_write', context: { strategyId: 'strat-1' },
    })
    service.setEvolutionary({ promote })

    await service.approve('g2', 'marcelo')

    expect(promote).not.toHaveBeenCalled()
  })

  it('não quebra a aprovação quando o context não tem strategyId', async () => {
    const { service, promote } = buildService({
      id: 'g3', type: 'strategy_promotion', context: {},
    })
    service.setEvolutionary({ promote })

    await expect(service.approve('g3', 'marcelo')).resolves.toBeDefined()
    expect(promote).not.toHaveBeenCalled()
  })

  it('não quebra a aprovação quando o EvolutionaryService não foi injetado', async () => {
    // Prefere-se aprovar e logar o erro a derrubar o pedido do humano — mas o log
    // precisa ser explícito, senão volta a ser falha silenciosa.
    const { service } = buildService({
      id: 'g4', type: 'strategy_promotion', context: { strategyId: 'strat-1' },
    })

    await expect(service.approve('g4', 'marcelo')).resolves.toBeDefined()
  })

  it('não quebra a aprovação quando promote() falha', async () => {
    const { service, promote } = buildService({
      id: 'g5', type: 'strategy_promotion', context: { strategyId: 'strat-1' },
    })
    promote.mockRejectedValue(new Error('estratégia não existe'))
    service.setEvolutionary({ promote })

    await expect(service.approve('g5', 'marcelo')).resolves.toBeDefined()
    expect(promote).toHaveBeenCalled()
  })
})
