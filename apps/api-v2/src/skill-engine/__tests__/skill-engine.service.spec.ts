import { SkillEngineService } from '../skill-engine.service'
import { SkillDefinition } from '../skill-registry'

function buildSkill(overrides: Partial<SkillDefinition> = {}): SkillDefinition {
  return {
    id:           'guardian:status',
    name:         'Guardian Status',
    description:  'desc',
    category:     'guardian',
    risk:         'none',
    runtime:      'in-process',
    version:      '1.0',
    inputSchema:  {},
    outputSchema: {},
    ...overrides,
  }
}

function buildDeps(skill: SkillDefinition) {
  const gates = {
    findPending:    jest.fn().mockResolvedValue([]),
    approve:        jest.fn().mockResolvedValue({ id: 'gate-1', status: 'approved' }),
    reject:         jest.fn().mockResolvedValue({ id: 'gate-1', status: 'rejected' }),
  }
  const registry = {
    resolve:  jest.fn().mockResolvedValue(skill),
    logUsage: jest.fn().mockResolvedValue(undefined),
  }
  const guardian = {
    getLatest:  jest.fn().mockResolvedValue({ id: 'r1', riskLevel: 'medium' }),
    getHistory: jest.fn().mockResolvedValue([{ id: 'r1' }]),
    override:   jest.fn().mockResolvedValue({ id: 'r1', overridden: true }),
  }
  const svc = new SkillEngineService(gates as never, registry as never, guardian as never)
  return { svc, gates, registry, guardian }
}

describe('SkillEngineService — skills in-process do Guardian', () => {
  it('guardian:status delega a GuardianService.getLatest e não dispara fetch externo', async () => {
    const { svc, guardian } = buildDeps(buildSkill({ id: 'guardian:status' }))
    const result = await svc.run({ skillId: 'guardian:status', input: { projectId: 'p1' } })

    expect(guardian.getLatest).toHaveBeenCalledWith('p1')
    expect(result.success).toBe(true)
    expect(result.output).toEqual({ report: { id: 'r1', riskLevel: 'medium' } })
  })

  it('guardian:history delega a GuardianService.getHistory', async () => {
    const { svc, guardian } = buildDeps(buildSkill({ id: 'guardian:history' }))
    const result = await svc.run({ skillId: 'guardian:history', input: { projectId: 'p1' } })

    expect(guardian.getHistory).toHaveBeenCalledWith('p1')
    expect(result.output).toEqual({ reports: [{ id: 'r1' }] })
  })

  it('guardian:override delega a GuardianService.override', async () => {
    const { svc, guardian } = buildDeps(buildSkill({ id: 'guardian:override', risk: 'high' }))
    const result = await svc.run({ skillId: 'guardian:override', input: { reportId: 'r1', reason: 'deploy emergencial' } })

    expect(guardian.override).toHaveBeenCalledWith('r1', 'deploy emergencial')
    expect(result.success).toBe(true)
  })

  it('guardian:review_gates filtra apenas gates do tipo guardian_review', async () => {
    const { svc, gates } = buildDeps(buildSkill({ id: 'guardian:review_gates' }))
    gates.findPending.mockResolvedValueOnce([
      { id: 'g1', type: 'guardian_review' },
      { id: 'g2', type: 'specialist_spawn' },
    ])

    const result = await svc.run({ skillId: 'guardian:review_gates', input: { projectId: 'p1' } })

    expect(gates.findPending).toHaveBeenCalledWith('p1')
    expect(result.output).toEqual({ gates: [{ id: 'g1', type: 'guardian_review' }] })
  })

  it('guardian:approve_review delega a ApprovalGatesService.approve', async () => {
    const { svc, gates } = buildDeps(buildSkill({ id: 'guardian:approve_review', risk: 'medium' }))
    const result = await svc.run({ skillId: 'guardian:approve_review', input: { gateId: 'gate-1', approvedBy: 'marcelo' } })

    expect(gates.approve).toHaveBeenCalledWith('gate-1', 'marcelo', undefined)
    expect(result.success).toBe(true)
  })

  it('guardian:reject_review delega a ApprovalGatesService.reject', async () => {
    const { svc, gates } = buildDeps(buildSkill({ id: 'guardian:reject_review', risk: 'medium' }))
    const result = await svc.run({ skillId: 'guardian:reject_review', input: { gateId: 'gate-1', approvedBy: 'marcelo', comment: 'nao aprovado' } })

    expect(gates.reject).toHaveBeenCalledWith('gate-1', 'marcelo', 'nao aprovado')
    expect(result.success).toBe(true)
  })

  it('skill desconhecida em runtime in-process retorna failure sem lançar', async () => {
    const { svc } = buildDeps(buildSkill({ id: 'guardian:nope' }))
    const result = await svc.run({ skillId: 'guardian:nope', input: {} })

    expect(result.success).toBe(false)
    expect(result.output.error).toContain("No in-process handler registered for skill 'guardian:nope'")
  })

  it('dryRun não executa o handler in-process, apenas simula', async () => {
    const { svc, guardian } = buildDeps(buildSkill({ id: 'guardian:status' }))
    const result = await svc.run({ skillId: 'guardian:status', input: { projectId: 'p1' }, dryRun: true })

    expect(guardian.getLatest).not.toHaveBeenCalled()
    expect(result.output).toMatchObject({ dryRun: true, skill: 'guardian:status', runtime: 'in-process' })
  })
})
