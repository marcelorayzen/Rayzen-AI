import { StepExecutorService } from '../step-executor.service'

function buildStep(overrides: Partial<{
  id: string; title: string; status: string; executor: string;
  prompt: string | null; input: Record<string, unknown> | null;
  dependsOn: string[]; output: unknown; skillId: string | null;
  retries: number;
}> = {}) {
  return {
    id: 's1', title: 'Test Step', status: 'pending', executor: 'ai',
    prompt: 'Do something', input: null, dependsOn: [], output: null, skillId: null, retries: 0,
    ...overrides,
  }
}

function buildMission(steps: ReturnType<typeof buildStep>[], overrides: Record<string, unknown> = {}) {
  return {
    id: 'm1', title: 'Test Mission', objective: 'Test', status: 'active',
    projectId: 'p1', specialistId: null, steps,
    ...overrides,
  }
}

function buildService() {
  const missions = {
    findOne:          jest.fn(),
    updateStep:       jest.fn().mockResolvedValue({}),
    transition:       jest.fn().mockResolvedValue({}),
    findRunningSteps: jest.fn().mockResolvedValue([]),
  }
  const specialists = {
    spawnAndWait: jest.fn().mockResolvedValue({ status: 'done', output: { result: 'ok' }, iterations: 1, costUsd: 0.01 }),
    isKnownType:  jest.fn().mockReturnValue(false),
    inferType:    jest.fn().mockReturnValue('coder'),
  }
  const agents      = { findById: jest.fn().mockResolvedValue(null) }
  const gates       = { findPending: jest.fn().mockResolvedValue([]) }
  const skillEngine = { run: jest.fn() }
  const result      = { processCompletion: jest.fn().mockResolvedValue(undefined) }

  const svc = new StepExecutorService(
    missions as never, specialists as never, agents as never,
    gates as never, skillEngine as never, result as never,
  )
  return { svc, missions, specialists, agents, gates, skillEngine, result }
}

// Drena microtask queue (runNext é fire-and-forget via .then())
const flush = () => new Promise((r) => setImmediate(r))

describe('StepExecutorService.runNext — dependsOn', () => {
  it('não executa step cujas deps não estão done', async () => {
    const { svc, missions } = buildService()
    const s1 = buildStep({ id: 's1', status: 'pending', dependsOn: [] })
    const s2 = buildStep({ id: 's2', status: 'pending', dependsOn: ['s1'] })  // deps não done
    missions.findOne.mockResolvedValue(buildMission([s1, s2]))
    jest.spyOn(svc, 'run').mockResolvedValue({ status: 'done', output: {} })

    svc.runNext('m1')
    await flush()

    // Só s1 pode rodar (sem deps); s2 bloqueado
    expect(svc.run).toHaveBeenCalledWith('m1', 's1')
    expect(svc.run).not.toHaveBeenCalledWith('m1', 's2')
  })

  it('executa step quando todas deps estão done', async () => {
    const { svc, missions } = buildService()
    const s1 = buildStep({ id: 's1', status: 'done',    dependsOn: [] })
    const s2 = buildStep({ id: 's2', status: 'pending', dependsOn: ['s1'] })
    missions.findOne.mockResolvedValue(buildMission([s1, s2]))
    jest.spyOn(svc, 'run').mockResolvedValue({ status: 'done', output: {} })

    svc.runNext('m1')
    await flush()

    expect(svc.run).toHaveBeenCalledWith('m1', 's2')
  })

  it('não executa o step downstream cujo antecessor ainda está pendente', async () => {
    const { svc, missions } = buildService()
    const s1 = buildStep({ id: 's1', status: 'done',    dependsOn: [] })
    const s2 = buildStep({ id: 's2', status: 'pending', dependsOn: ['s1'] })
    const s3 = buildStep({ id: 's3', status: 'pending', dependsOn: ['s2'] })  // s2 ainda pending
    missions.findOne.mockResolvedValue(buildMission([s1, s2, s3]))
    jest.spyOn(svc, 'run').mockResolvedValue({ status: 'done', output: {} })

    svc.runNext('m1')
    await flush()

    expect(svc.run).toHaveBeenCalledWith('m1', 's2')
    expect(svc.run).not.toHaveBeenCalledWith('m1', 's3')
  })

  it('transiciona missão para done quando todos os steps são terminais', async () => {
    const { svc, missions } = buildService()
    const s1 = buildStep({ id: 's1', status: 'done' })
    const s2 = buildStep({ id: 's2', status: 'done' })
    missions.findOne.mockResolvedValue(buildMission([s1, s2]))

    svc.runNext('m1')
    await flush()

    expect(missions.transition).toHaveBeenCalledWith('m1', 'done')
  })

  it('transiciona para failed quando há step failed e nenhum pending', async () => {
    const { svc, missions } = buildService()
    const s1 = buildStep({ id: 's1', status: 'done' })
    const s2 = buildStep({ id: 's2', status: 'failed' })
    missions.findOne.mockResolvedValue(buildMission([s1, s2]))

    svc.runNext('m1')
    await flush()

    expect(missions.transition).toHaveBeenCalledWith('m1', 'failed')
  })
})

describe('StepExecutorService.run — early exits', () => {
  it('retorna imediatamente se step já está done', async () => {
    const { svc, missions, specialists } = buildService()
    const step = buildStep({ status: 'done', output: { result: 'cached' } })
    missions.findOne.mockResolvedValue(buildMission([step]))
    // runNext não precisa de spy aqui — run retorna antes de chegar nele

    const out = await svc.run('m1', 's1')

    expect(out.status).toBe('done')
    expect(specialists.spawnAndWait).not.toHaveBeenCalled()
  })

  it('pausa missão e retorna awaiting_human para executor=human', async () => {
    const { svc, missions, specialists } = buildService()
    const step = buildStep({ executor: 'human' })
    missions.findOne.mockResolvedValue(buildMission([step]))

    const out = await svc.run('m1', 's1')

    expect(out.status).toBe('blocked')
    expect((out.output as Record<string, unknown>)['reason']).toBe('awaiting_human')
    expect(missions.transition).toHaveBeenCalledWith('m1', 'paused')
    expect(specialists.spawnAndWait).not.toHaveBeenCalled()
  })
})

describe('StepExecutorService.run — clarificationAnswer', () => {
  it('injeta clarificationAnswer no task quando presente em step.input', async () => {
    const { svc, missions, specialists } = buildService()
    // Spy em runNext para evitar loop infinito: run → done → runNext → run → ...
    jest.spyOn(svc, 'runNext').mockImplementation(() => undefined)
    const step = buildStep({
      prompt: 'Analise o serviço',
      input:  { clarificationAnswer: 'Focar em performance' },
    })
    missions.findOne.mockResolvedValue(buildMission([step]))

    await svc.run('m1', 's1')

    const call = specialists.spawnAndWait.mock.calls[0][0] as { task: string }
    expect(call.task).toContain('Analise o serviço')
    expect(call.task).toContain('Focar em performance')
  })

  it('usa prompt original sem clarificação quando input é null', async () => {
    const { svc, missions, specialists } = buildService()
    jest.spyOn(svc, 'runNext').mockImplementation(() => undefined)
    const step = buildStep({ prompt: 'Só o prompt', input: null })
    missions.findOne.mockResolvedValue(buildMission([step]))

    await svc.run('m1', 's1')

    const call = specialists.spawnAndWait.mock.calls[0][0] as { task: string }
    expect(call.task).toBe('Só o prompt')
  })
})

describe('StepExecutorService.run — prevOutputs de dependsOn', () => {
  it('injeta output do step dependente no contexto do specialist', async () => {
    const { svc, missions, specialists } = buildService()
    jest.spyOn(svc, 'runNext').mockImplementation(() => undefined)
    const dep  = buildStep({ id: 's0', status: 'done', output: { result: 'resultado do step anterior' } })
    const step = buildStep({ id: 's1', dependsOn: ['s0'] })
    missions.findOne.mockResolvedValue(buildMission([dep, step]))

    await svc.run('m1', 's1')

    const call = specialists.spawnAndWait.mock.calls[0][0] as { context: string }
    expect(call.context).toContain('resultado do step anterior')
  })

  it('não injeta prevOutputs quando dependsOn está vazio', async () => {
    const { svc, missions, specialists } = buildService()
    jest.spyOn(svc, 'runNext').mockImplementation(() => undefined)
    const step = buildStep({ id: 's1', dependsOn: [] })
    missions.findOne.mockResolvedValue(buildMission([step]))

    await svc.run('m1', 's1')

    const call = specialists.spawnAndWait.mock.calls[0][0] as { context: string }
    expect(call.context).not.toContain('prevOutputs')
  })
})
