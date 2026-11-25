import { WorkflowEngineService, WORKFLOW_TEMPLATES } from '../workflow-engine.service'

function buildStep(overrides: Partial<{
  id: string; title: string; status: string; executor: string;
  skillId: string | null; prompt: string | null;
  dependsOn: string[]; input: Record<string, unknown>; retries: number;
}> = {}) {
  return {
    id: 's1', title: 'Test Step', status: 'pending', executor: 'ai',
    skillId: null, prompt: 'Do something', dependsOn: [], input: {}, retries: 0,
    ...overrides,
  }
}

function buildMission(status: string, steps: ReturnType<typeof buildStep>[], specialistId: string | null = null) {
  return { id: 'm1', title: 'Test', objective: 'Test obj', status, projectId: 'p1', specialistId, steps }
}

function buildService() {
  const missions = {
    findOne:    jest.fn(),
    listSteps:  jest.fn(),
    updateStep: jest.fn().mockResolvedValue({}),
    transition: jest.fn().mockResolvedValue({}),
    addStep:    jest.fn(),
  }
  const missionResult  = { processCompletion: jest.fn().mockResolvedValue({ summary: 'ok' }) }
  const skillEngine    = { run: jest.fn() }
  const aiRouter       = {}
  const specialists    = {
    spawn:     jest.fn(),
    getStatus: jest.fn(),
  }
  const specialistAgents = { findById: jest.fn().mockResolvedValue(null) }
  const gates = {
    findPending:            jest.fn().mockResolvedValue([]),
    createClarificationGate: jest.fn(),
  }
  const docs          = { onMissionCompleted: jest.fn().mockResolvedValue([]) }
  const clarification = { checkTask: jest.fn().mockResolvedValue({ needsClarification: false }) }
  const contextEngine = { buildSurgical: jest.fn().mockResolvedValue(null) }
  const policyEngine  = {
    evaluate: jest.fn().mockResolvedValue({
      allowed: true, violations: [], warnings: [], gateRequired: false, gateViolations: [], exemptions: [],
    }),
  }

  const svc = new WorkflowEngineService(
    missions as never, missionResult as never, skillEngine as never,
    aiRouter as never, specialists as never, specialistAgents as never,
    gates as never, docs as never, clarification as never, contextEngine as never,
    policyEngine as never,
  )
  return { svc, missions, missionResult, skillEngine, specialists, gates, docs, clarification, contextEngine, policyEngine, specialistAgents }
}

describe('WorkflowEngineService.execute — early exit', () => {
  it('retorna zeros sem executar nada para missão em status final', async () => {
    const { svc, missions, specialists } = buildService()
    for (const status of ['done', 'failed', 'cancelled']) {
      missions.findOne.mockResolvedValue(buildMission(status, []))
      const result = await svc.execute('m1', 'p1')
      expect(result).toEqual({ completed: 0, failed: 0, pending: 0, docsGenerated: [] })
    }
    expect(specialists.spawn).not.toHaveBeenCalled()
  })
})

describe('WorkflowEngineService.execute — ciclo completo', () => {
  it('ativa missão pending e finaliza como done quando step completa', async () => {
    const { svc, missions, specialists, gates } = buildService()
    const step = buildStep()

    missions.findOne.mockResolvedValue(buildMission('pending', [step]))
    gates.findPending.mockResolvedValue([])
    specialists.spawn.mockResolvedValue({ id: 'sp1', status: 'done', output: { result: 'ok' } })
    // listSteps: 1) refresh após executeStep 2) tally final
    missions.listSteps.mockResolvedValue([{ ...step, status: 'done' }])

    await svc.execute('m1', 'p1')

    expect(missions.transition).toHaveBeenCalledWith('m1', 'active')
    expect(missions.transition).toHaveBeenCalledWith('m1', 'done')
  })

  it('transiciona para failed quando step falha', async () => {
    const { svc, missions, specialists, gates } = buildService()
    const step = buildStep()

    missions.findOne.mockResolvedValue(buildMission('active', [step]))
    gates.findPending.mockResolvedValue([])
    specialists.spawn.mockResolvedValue({ id: 'sp1', status: 'failed', output: {} })
    missions.listSteps.mockResolvedValue([{ ...step, status: 'failed' }])

    await svc.execute('m1', 'p1')

    expect(missions.transition).toHaveBeenCalledWith('m1', 'failed')
    expect(missions.transition).not.toHaveBeenCalledWith('m1', 'done')
  })

  it('não despacha step com executor=human e pausa a missão', async () => {
    const { svc, missions, specialists, gates } = buildService()
    const step = buildStep({ executor: 'human' })

    missions.findOne.mockResolvedValue(buildMission('active', [step]))
    gates.findPending.mockResolvedValue([])
    missions.listSteps.mockResolvedValue([step])  // ainda pending

    await svc.execute('m1', 'p1')

    expect(specialists.spawn).not.toHaveBeenCalled()
    expect(missions.transition).toHaveBeenCalledWith('m1', 'paused')
  })

  it('pausa missão quando step está bloqueado por ApprovalGate pendente', async () => {
    const { svc, missions, specialists, gates } = buildService()
    const step = buildStep({ id: 's1' })

    missions.findOne.mockResolvedValue(buildMission('active', [step]))
    gates.findPending.mockResolvedValue([{ id: 'g1', stepId: 's1', missionId: 'm1' }])
    missions.listSteps.mockResolvedValue([step])  // pending + gated

    await svc.execute('m1', 'p1')

    expect(specialists.spawn).not.toHaveBeenCalled()
    expect(missions.transition).toHaveBeenCalledWith('m1', 'paused')
  })

  it('não executa step cuja dep nunca será satisfeita (dep inexistente)', async () => {
    const { svc, missions, specialists, gates } = buildService()
    const s1 = buildStep({ id: 's1', status: 'pending', dependsOn: [] })
    // s2 depende de 'ghost-id' que não existe na missão — nunca pode rodar
    const s2 = buildStep({ id: 's2', title: 'Step 2', status: 'pending', dependsOn: ['ghost-id'] })

    missions.findOne.mockResolvedValue(buildMission('active', [s1, s2]))
    gates.findPending.mockResolvedValue([])
    specialists.spawn.mockResolvedValue({ id: 'sp1', status: 'done', output: { result: 'ok' } })
    // s1 refresh + final tally: s1 done, s2 pending
    missions.listSteps.mockResolvedValue([{ ...s1, status: 'done' }, s2])

    await svc.execute('m1', 'p1')

    // specialist só foi chamado para s1 — s2 fica bloqueado pela dep inexistente
    expect(specialists.spawn).toHaveBeenCalledTimes(1)
    expect(specialists.spawn.mock.calls[0][0]).toMatchObject({ stepId: 's1' })
  })
})

describe('WorkflowEngineService.execute — StepInterruptedError', () => {
  it('marca step como skipped (não failed) quando specialist é interrompido por gate durante tool-use', async () => {
    const { svc, missions, specialists, gates, clarification } = buildService()
    const step = buildStep()

    missions.findOne.mockResolvedValue(buildMission('active', [step]))
    gates.findPending.mockResolvedValue([])
    clarification.checkTask.mockResolvedValue({ needsClarification: false })
    // Specialist interrompido no meio — status interrupted
    specialists.spawn.mockResolvedValue({
      id: 'sp1', status: 'interrupted',
      output: { gateId: 'g-new', question: 'Precisa de aprovação?' },
    })
    missions.listSteps.mockResolvedValue([{ ...step, status: 'skipped' }])

    await svc.execute('m1', 'p1')

    expect(missions.updateStep).toHaveBeenCalledWith('m1', 's1', { status: 'skipped', output: expect.any(Object) })
    // Não deve ter tentado retry (é StepInterruptedError, não falha real)
  })
})

describe('WorkflowEngineService — política Synthesizer (Guardian Blueprint v1.1, item 10)', () => {
  it('gateia (não falha) quando PolicyEngine exige gate para um specialist synthesizer', async () => {
    const { svc, missions, specialists, gates, policyEngine, specialistAgents } = buildService()
    const step = buildStep()
    const mission = buildMission('active', [step], 'agent-1')

    specialistAgents.findById.mockResolvedValue({ id: 'agent-1', domain: 'synthesizer' })
    missions.findOne.mockResolvedValue(mission)
    gates.findPending.mockResolvedValue([])
    policyEngine.evaluate.mockResolvedValue({
      allowed: true, violations: [], warnings: [],
      gateRequired: true, gateViolations: [{ rule: 'synthesizer_requires_sources', action: 'gate', message: 'sem fontes' }],
      gateId: 'gate-policy-1', exemptions: [],
    })
    missions.listSteps.mockResolvedValue([{ ...step, status: 'skipped' }])

    await svc.execute('m1', 'p1')

    expect(specialists.spawn).not.toHaveBeenCalled()
    expect(policyEngine.evaluate).toHaveBeenCalledWith(expect.objectContaining({
      operation: 'specialist_run',
      data: expect.objectContaining({ specialistType: 'synthesizer' }),
    }))
    expect(missions.updateStep).toHaveBeenCalledWith('m1', 's1', {
      status: 'skipped',
      output: expect.objectContaining({ gateId: 'gate-policy-1', status: 'policy_gate_pending' }),
    })
  })

  it('prossegue normalmente quando PolicyEngine permite o specialist synthesizer', async () => {
    const { svc, missions, specialists, gates, policyEngine, specialistAgents } = buildService()
    const step = buildStep()
    const mission = buildMission('active', [step], 'agent-1')

    specialistAgents.findById.mockResolvedValue({ id: 'agent-1', domain: 'synthesizer' })
    missions.findOne.mockResolvedValue(mission)
    gates.findPending.mockResolvedValue([])
    specialists.spawn.mockResolvedValue({ id: 'sp1', status: 'done', output: { result: 'ok' } })
    missions.listSteps.mockResolvedValue([{ ...step, status: 'done' }])

    await svc.execute('m1', 'p1')

    expect(policyEngine.evaluate).toHaveBeenCalledTimes(1)
    expect(specialists.spawn).toHaveBeenCalledTimes(1)
    expect(missions.transition).toHaveBeenCalledWith('m1', 'done')
  })

  it('não avalia política para specialists que não são synthesizer', async () => {
    const { svc, missions, specialists, gates, policyEngine } = buildService()
    const step = buildStep()

    missions.findOne.mockResolvedValue(buildMission('active', [step])) // specialistId null → type undefined
    gates.findPending.mockResolvedValue([])
    specialists.spawn.mockResolvedValue({ id: 'sp1', status: 'done', output: { result: 'ok' } })
    missions.listSteps.mockResolvedValue([{ ...step, status: 'done' }])

    await svc.execute('m1', 'p1')

    expect(policyEngine.evaluate).not.toHaveBeenCalled()
    expect(specialists.spawn).toHaveBeenCalledTimes(1)
  })
})

describe('WorkflowEngineService.applyTemplate', () => {
  it('cria steps com dependsOn corretos para template implementation', async () => {
    const { svc, missions } = buildService()
    missions.findOne.mockResolvedValue(buildMission('pending', []))

    const keys = ['context', 'plan', 'implement', 'test', 'review', 'document']
    const idMap: Record<string, string> = {}
    let callCount = 0
    missions.addStep.mockImplementation(async (_mId: string, data: { title: string }) => {
      const key = keys[callCount++]
      const id  = `${key}-id`
      idMap[key] = id
      return { id, title: data.title }
    })

    const result = await svc.applyTemplate('m1', 'implementation')

    expect(result.stepsCreated).toBe(6)
    expect(missions.addStep).toHaveBeenCalledTimes(6)
    // plan depende de context
    expect(missions.updateStep).toHaveBeenCalledWith('m1', 'plan-id', { dependsOn: ['context-id'] })
    // implement depende de plan
    expect(missions.updateStep).toHaveBeenCalledWith('m1', 'implement-id', { dependsOn: ['plan-id'] })
  })

  it('lança erro para template desconhecido', async () => {
    const { svc } = buildService()
    await expect(svc.applyTemplate('m1', 'inexistente')).rejects.toThrow("Template 'inexistente' not found")
  })
})

describe('WorkflowEngineService.getTemplates', () => {
  it('retorna todos os templates com seus steps', () => {
    const { svc } = buildService()
    const templates = svc.getTemplates()

    expect(templates.map(t => t.type)).toEqual(expect.arrayContaining(['implementation', 'debugging', 'review']))
    const impl = templates.find(t => t.type === 'implementation')!
    expect(impl.steps.length).toBe(WORKFLOW_TEMPLATES.implementation.length)
  })
})
