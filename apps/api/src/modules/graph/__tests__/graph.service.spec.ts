import { GraphService, GapAnalysis } from '../graph.service'

/**
 * Sem isso, marcar um critério como done via toggleCriteria() nunca sincronizava
 * state.nextSteps — que fica desatualizado até um refresh manual ou checkpoint.
 * O próprio analyzeGap() manda state.nextSteps (desatualizado) pro LLM junto com
 * os criteria (corretos), e a IA ecoava o lado desatualizado. Achado real: qa-1
 * marcado done não tirava "implementar pipeline fechado" do gapAnalysis.
 *
 * Disparar refresh() sozinho não bastou: ProjectStateService.refresh() só remove
 * um next-step se um evento NOVO mostrar que foi resolvido (regra incremental
 * intencional, ver memória project_state_synthesis_incremental) — toggleCriteria
 * precisa criar esse evento de decisão, não só chamar refresh.
 */
describe('GraphService.toggleCriteria — sincroniza ProjectState', () => {
  function buildService(
    goal: { id: string; projectId: string; successCriteria: unknown },
    nextSteps: Array<{ id: string; title: string }> = [],
  ) {
    const prisma = {
      projectGoal: {
        findUniqueOrThrow: jest.fn().mockResolvedValue(goal),
        update: jest.fn().mockResolvedValue({ ...goal, successCriteria: goal.successCriteria }),
      },
    }
    const stateService = {
      refresh: jest.fn().mockResolvedValue({}),
      get: jest.fn().mockResolvedValue({ nextSteps }),
      updatePlanning: jest.fn().mockResolvedValue({}),
    }
    const healthService = {}
    const config = { get: jest.fn().mockReturnValue(undefined) }
    const metrics = {}
    const events = { create: jest.fn().mockResolvedValue({}) }

    const service = new GraphService(
      prisma as never, stateService as never, healthService as never, config as never, metrics as never, events as never,
    )
    return { service, prisma, stateService, events }
  }

  it('dispara refresh do ProjectState do projeto certo após marcar um critério', async () => {
    const goal = { id: 'g1', projectId: 'p1', successCriteria: [{ id: 'qa-1', text: 'x', done: false }] }
    const { service, stateService } = buildService(goal)

    await service.toggleCriteria('g1', 'qa-1', true)
    await new Promise((r) => setImmediate(r))

    expect(stateService.refresh).toHaveBeenCalledWith('p1')
  })

  it('cria um evento de decisão explícito — é o sinal que o refresh incremental precisa pra remover o next-step', async () => {
    const goal = { id: 'g1', projectId: 'p1', successCriteria: [{ id: 'qa-1', text: 'Pipeline fechado de QA', done: false }] }
    const { service, events } = buildService(goal)

    await service.toggleCriteria('g1', 'qa-1', true)

    expect(events.create).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'p1',
      intent:    'decision',
      content:   'Critério de sucesso concluído: Pipeline fechado de QA',
    }))
  })

  it('marca o evento como "revertido" quando o critério volta pra pendente', async () => {
    const goal = { id: 'g1', projectId: 'p1', successCriteria: [{ id: 'qa-1', text: 'Pipeline fechado de QA', done: true }] }
    const { service, events } = buildService(goal)

    await service.toggleCriteria('g1', 'qa-1', false)

    expect(events.create).toHaveBeenCalledWith(expect.objectContaining({
      content: 'Critério de sucesso revertido para pendente: Pipeline fechado de QA',
    }))
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

  // goal-2: warnPendingGoalProposals (SynthesisService) põe "confirmar-<id>" em
  // nextSteps quando propõe um critério com evidência. Confirmar o critério
  // precisa limpar isso — senão fica preso em nextSteps pra sempre (refresh()
  // não dá garantia de remover, é não-determinístico).
  it('remove o next-step de confirmação ao marcar o critério correspondente como done', async () => {
    const goal = { id: 'g1', projectId: 'p1', successCriteria: [{ id: 'goal-2', text: 'x', done: false }] }
    const { service, stateService } = buildService(goal, [
      { id: 'confirmar-goal-2', title: 'Confirmar critério concluído: x' },
      { id: 'outro-passo', title: 'Não relacionado' },
    ])

    await service.toggleCriteria('g1', 'goal-2', true)
    await new Promise((r) => setImmediate(r))

    expect(stateService.updatePlanning).toHaveBeenCalledWith('p1', {
      nextSteps: [{ id: 'outro-passo', title: 'Não relacionado' }],
    })
  })

  it('não toca em nextSteps quando não há next-step de confirmação pendente pra esse critério', async () => {
    const goal = { id: 'g1', projectId: 'p1', successCriteria: [{ id: 'goal-2', text: 'x', done: false }] }
    const { service, stateService } = buildService(goal, [{ id: 'outro-passo', title: 'Não relacionado' }])

    await service.toggleCriteria('g1', 'goal-2', true)
    await new Promise((r) => setImmediate(r))

    expect(stateService.updatePlanning).not.toHaveBeenCalled()
  })

  it('não remove next-step ao reverter um critério pra pendente (done: false)', async () => {
    const goal = { id: 'g1', projectId: 'p1', successCriteria: [{ id: 'goal-2', text: 'x', done: true }] }
    const { service, stateService } = buildService(goal, [
      { id: 'confirmar-goal-2', title: 'Confirmar critério concluído: x' },
    ])

    await service.toggleCriteria('g1', 'goal-2', false)
    await new Promise((r) => setImmediate(r))

    expect(stateService.updatePlanning).not.toHaveBeenCalled()
  })
})

/**
 * Achado real: GET /projects/:id/graph/goal retornava 500 pra um projeto com goal
 * ativo (TypeError: Cannot read properties of undefined (reading 'replace') em
 * sanitize()). Causa: extractJson() no JSON livre da LLM (sem response_format) às
 * vezes retorna um gap sem "description", e buildGoalMermaid() chamava sanitize()
 * direto nesse campo sem validar. normalizeGapAnalysis() é a correção — valida a
 * saída da LLM na fronteira, antes de qualquer downstream confiar nos tipos.
 */
describe('GraphService.normalizeGapAnalysis — saneia saída malformada da LLM', () => {
  function buildService() {
    const goal = { id: 'g1', projectId: 'p1', successCriteria: [] }
    const prisma = { projectGoal: { findUniqueOrThrow: jest.fn().mockResolvedValue(goal), update: jest.fn() } }
    const stateService = {}
    const healthService = {}
    const config = { get: jest.fn().mockReturnValue(undefined) }
    const metrics = {}
    const events = {}
    return new GraphService(
      prisma as never, stateService as never, healthService as never, config as never, metrics as never, events as never,
    )
  }

  function normalize(service: GraphService, parsed: Partial<GapAnalysis>, fallback = 0): GapAnalysis {
    return (service as unknown as { normalizeGapAnalysis: (p: Partial<GapAnalysis>, f: number) => GapAnalysis })
      .normalizeGapAnalysis(parsed, fallback)
  }

  it('preenche description vazia quando o gap vem sem o campo (em vez de undefined)', () => {
    const service = buildService()
    const result = normalize(service, { gaps: [{ area: 'focus' } as never] })

    expect(result.gaps[0].description).toBe('')
    expect(typeof result.gaps[0].description).toBe('string')
  })

  it('descarta area fora do enum esperado e usa "focus" como fallback', () => {
    const service = buildService()
    const result = normalize(service, { gaps: [{ area: 'blocker|milestone|kpi|risk|focus', description: 'x' } as never] })

    expect(result.gaps[0].area).toBe('focus')
  })

  it('usa o progresso calculado localmente quando goalProgress não é número', () => {
    const service = buildService()
    const result = normalize(service, { goalProgress: 'quarenta por cento' as never }, 42)

    expect(result.goalProgress).toBe(42)
  })

  it('retorna gaps vazio (não crasha) quando "gaps" não é um array', () => {
    const service = buildService()
    const result = normalize(service, { gaps: 'nenhum gap' as never })

    expect(result.gaps).toEqual([])
  })
})

/**
 * Achado real (projeto cliente VB Ferragens): successCriteria salvo no banco como
 * [{id, done}] sem "text" — buildGoalMermaid() chamava sanitize(c.text) e crashava
 * com TypeError em produção (500 em GET /graph/goal). sanitize() agora aceita
 * unknown e nunca lança, independente do que vier no JSON armazenado.
 */
describe('GraphService.buildGoalMermaid — não crasha com successCriteria incompleto', () => {
  function buildService() {
    const prisma = {}
    const stateService = {}
    const healthService = {}
    const config = { get: jest.fn().mockReturnValue(undefined) }
    const metrics = {}
    const events = {}
    return new GraphService(
      prisma as never, stateService as never, healthService as never, config as never, metrics as never, events as never,
    )
  }

  function buildMermaid(service: GraphService, goal: { title: string; successCriteria: unknown; targetDate: Date | null }, gap: GapAnalysis | null): string {
    return (service as unknown as { buildGoalMermaid: (g: typeof goal, gap: GapAnalysis | null) => string })
      .buildGoalMermaid(goal, gap)
  }

  it('renderiza critério sem campo "text" como texto vazio em vez de lançar', () => {
    const service = buildService()
    const goal = { title: 'Lançar MVP', successCriteria: [{ id: 'sc1', done: false }], targetDate: null }

    expect(() => buildMermaid(service, goal, null)).not.toThrow()
    expect(buildMermaid(service, goal, null)).toContain('C0["[ ] "]')
  })
})
