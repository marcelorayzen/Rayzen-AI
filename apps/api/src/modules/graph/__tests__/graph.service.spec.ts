import { GraphService } from '../graph.service'

/**
 * Sem isso, marcar um critério como done via toggleCriteria() nunca sincronizava
 * state.nextSteps — que fica desatualizado até um refresh manual ou checkpoint.
 * O próprio analyzeGap() manda state.nextSteps (desatualizado) pro LLM junto com
 * os criteria (corretos), e a IA ecoava o lado desatualizado. Achado real: qa-1
 * marcado done não tirava "implementar pipeline fechado" do gapAnalysis.
 */
describe('GraphService.toggleCriteria — sincroniza ProjectState', () => {
  function buildService(goal: { id: string; projectId: string; successCriteria: unknown }) {
    const prisma = {
      projectGoal: {
        findUniqueOrThrow: jest.fn().mockResolvedValue(goal),
        update: jest.fn().mockResolvedValue({ ...goal, successCriteria: goal.successCriteria }),
      },
    }
    const stateService = { refresh: jest.fn().mockResolvedValue({}) }
    const healthService = {}
    const config = { get: jest.fn().mockReturnValue(undefined) }
    const metrics = {}

    const service = new GraphService(
      prisma as never, stateService as never, healthService as never, config as never, metrics as never,
    )
    return { service, prisma, stateService }
  }

  it('dispara refresh do ProjectState do projeto certo após marcar um critério', async () => {
    const goal = { id: 'g1', projectId: 'p1', successCriteria: [{ id: 'qa-1', text: 'x', done: false }] }
    const { service, stateService } = buildService(goal)

    await service.toggleCriteria('g1', 'qa-1', true)
    await new Promise((r) => setImmediate(r))

    expect(stateService.refresh).toHaveBeenCalledWith('p1')
  })

  it('persiste o criterio marcado mesmo se o refresh do ProjectState falhar', async () => {
    const goal = { id: 'g1', projectId: 'p1', successCriteria: [{ id: 'qa-1', text: 'x', done: false }] }
    const { service, prisma, stateService } = buildService(goal)
    stateService.refresh.mockRejectedValue(new Error('llm indisponível'))

    const result = await service.toggleCriteria('g1', 'qa-1', true)

    expect(result).toBeDefined()
    expect(prisma.projectGoal.update).toHaveBeenCalledWith({
      where: { id: 'g1' },
      data: { successCriteria: [{ id: 'qa-1', text: 'x', done: true }] },
    })
  })
})
