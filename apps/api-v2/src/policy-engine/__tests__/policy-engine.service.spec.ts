import { PolicyEngineService } from '../policy-engine.service'

function buildRule(overrides: Partial<{
  id: string; projectId: string | null; name: string; action: string; config: Record<string, unknown>; enabled: boolean
}> = {}) {
  return {
    id: 'rule-1', projectId: null, name: 'synthesizer_requires_sources',
    description: 'desc', enabled: true, action: 'gate', config: {},
    createdAt: new Date(), updatedAt: new Date(),
    ...overrides,
  }
}

function buildService(rules: ReturnType<typeof buildRule>[], exceptions: Array<Record<string, unknown>> = []) {
  const prisma = {
    policyRule: {
      findMany: jest.fn().mockResolvedValue(rules),
    },
    policyException: {
      findMany: jest.fn().mockResolvedValue(exceptions),
      create:   jest.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'exc-1', ...data })),
      update:   jest.fn().mockImplementation(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => ({ id: where.id, ...data })),
    },
  }
  const gates = { create: jest.fn().mockResolvedValue({ id: 'gate-1' }) }
  const svc = new PolicyEngineService(prisma as never, gates as never)
  return { svc, prisma, gates }
}

describe('PolicyEngineService — política Synthesizer (Guardian Blueprint v1.1, item 10)', () => {
  it('bloqueia/gateia specialist synthesizer sem fontes prévias', async () => {
    const { svc, gates } = buildService([buildRule({ action: 'gate' })])

    const result = await svc.evaluate({
      operation: 'specialist_run',
      projectId: 'p1',
      data: { specialistType: 'synthesizer', hasSources: false },
    })

    expect(result.gateRequired).toBe(true)
    expect(result.gateViolations[0].rule).toBe('synthesizer_requires_sources')
    expect(result.exemptions).toEqual([])
    expect(gates.create).toHaveBeenCalled()
  })

  it('não dispara a regra quando o synthesizer tem fontes prévias', async () => {
    const { svc, gates } = buildService([buildRule({ action: 'gate' })])

    const result = await svc.evaluate({
      operation: 'specialist_run',
      projectId: 'p1',
      data: { specialistType: 'synthesizer', hasSources: true },
    })

    expect(result.gateRequired).toBe(false)
    expect(result.allowed).toBe(true)
    expect(gates.create).not.toHaveBeenCalled()
  })

  it('não dispara para outros tipos de specialist', async () => {
    const { svc } = buildService([buildRule({ action: 'gate' })])

    const result = await svc.evaluate({
      operation: 'specialist_run',
      projectId: 'p1',
      data: { specialistType: 'coder', hasSources: false },
    })

    expect(result.gateRequired).toBe(false)
    expect(result.allowed).toBe(true)
  })
})

describe('PolicyEngineService — exceções formalizadas e registradas (item 10)', () => {
  it('exceção ativa sem escopo cobre a violação — vira exemption, não gate/block', async () => {
    const exception = { id: 'exc-1', ruleId: 'rule-1', projectId: 'p1', reason: 'deploy emergencial aprovado por marcelo', scope: {}, expiresAt: null, revokedAt: null }
    const { svc, gates } = buildService([buildRule({ action: 'gate' })], [exception])

    const result = await svc.evaluate({
      operation: 'specialist_run',
      projectId: 'p1',
      data: { specialistType: 'synthesizer', hasSources: false },
    })

    expect(result.gateRequired).toBe(false)
    expect(result.exemptions).toHaveLength(1)
    expect(result.exemptions[0]).toMatchObject({ exceptionId: 'exc-1', reason: exception.reason, rule: 'synthesizer_requires_sources' })
    expect(gates.create).not.toHaveBeenCalled()
  })

  it('exceção com escopo de missionId só cobre a violação se o missionId bater', async () => {
    const exception = { id: 'exc-1', ruleId: 'rule-1', projectId: 'p1', reason: 'x', scope: { missionId: 'm-other' }, expiresAt: null, revokedAt: null }
    const { svc, gates } = buildService([buildRule({ action: 'gate' })], [exception])

    const result = await svc.evaluate({
      operation: 'specialist_run',
      projectId: 'p1',
      data: { specialistType: 'synthesizer', hasSources: false, missionId: 'm-this' },
    })

    expect(result.gateRequired).toBe(true)
    expect(result.exemptions).toEqual([])
    expect(gates.create).toHaveBeenCalled()
  })

  it('warn nunca consulta exceção — sempre vira warning mesmo com exceção ativa', async () => {
    const exception = { id: 'exc-1', ruleId: 'rule-1', projectId: 'p1', reason: 'x', scope: {}, expiresAt: null, revokedAt: null }
    const { svc, prisma } = buildService([buildRule({ action: 'warn' })], [exception])

    const result = await svc.evaluate({
      operation: 'specialist_run',
      projectId: 'p1',
      data: { specialistType: 'synthesizer', hasSources: false },
    })

    expect(result.warnings).toHaveLength(1)
    expect(result.exemptions).toEqual([])
    expect(prisma.policyException.findMany).not.toHaveBeenCalled()
  })

  it('createException registra a exceção via prisma', async () => {
    const { svc, prisma } = buildService([])

    const result = await svc.createException({
      ruleId: 'rule-1', projectId: 'p1', reason: 'janela de manutenção', grantedBy: 'marcelo',
    })

    expect(prisma.policyException.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ ruleId: 'rule-1', projectId: 'p1', reason: 'janela de manutenção', grantedBy: 'marcelo' }),
    })
    expect(result.id).toBe('exc-1')
  })

  it('revokeException marca revokedAt via prisma', async () => {
    const { svc, prisma } = buildService([])

    await svc.revokeException('exc-1')

    expect(prisma.policyException.update).toHaveBeenCalledWith({
      where: { id: 'exc-1' },
      data:  { revokedAt: expect.any(Date) },
    })
  })
})
