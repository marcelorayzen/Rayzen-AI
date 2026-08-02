import { SkillEngineService } from '../skill-engine.service'
import { SkillDefinition } from '../skill-registry'

function buildSkill(overrides: Partial<SkillDefinition> = {}): SkillDefinition {
  return {
    id:           'test:unknown',
    name:         'Test Unknown',
    description:  'desc',
    category:     'system',
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
    findPending: jest.fn().mockResolvedValue([]),
    approve:     jest.fn().mockResolvedValue({ id: 'gate-1', status: 'approved' }),
    reject:      jest.fn().mockResolvedValue({ id: 'gate-1', status: 'rejected' }),
  }
  const registry = {
    resolve:  jest.fn().mockResolvedValue(skill),
    logUsage: jest.fn().mockResolvedValue(undefined),
  }
  const svc = new SkillEngineService(gates as never, registry as never)
  return { svc, gates, registry }
}

describe('SkillEngineService — runtime in-process', () => {
  it('skill desconhecida em runtime in-process retorna failure sem lançar', async () => {
    const { svc } = buildDeps(buildSkill({ id: 'test:unknown' }))
    const result = await svc.run({ skillId: 'test:unknown', input: {} })

    expect(result.success).toBe(false)
    expect(result.output.error).toContain("No in-process handler registered for skill 'test:unknown'")
  })

  it('dryRun não executa o handler in-process, apenas simula', async () => {
    const { svc } = buildDeps(buildSkill({ id: 'test:unknown' }))
    const result = await svc.run({ skillId: 'test:unknown', input: {}, dryRun: true })

    expect(result.output).toMatchObject({ dryRun: true, skill: 'test:unknown', runtime: 'in-process' })
  })
})
