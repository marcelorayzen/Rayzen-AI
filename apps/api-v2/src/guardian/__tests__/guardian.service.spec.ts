import { GuardianService, GuardianAnalyzeDto } from '../guardian.service'

function buildDeps(overrides: {
  create?:    jest.Mock
  findFirst?: jest.Mock
  update?:    jest.Mock
} = {}) {
  const fakeReport = {
    id:                'r1',
    projectId:         'p1',
    repoPath:          '/repo',
    changedFiles:      ['apps/api-v2/src/auth/auth.service.ts'],
    impactedRoutes:    [],
    impactedModules:   ['auth'],
    filesWithoutTests: ['apps/api-v2/src/auth/auth.service.ts'],
    suggestedTests:    [],
    riskScore:         3.5,
    riskLevel:         'medium' as const,
    deployRecommend:   'review' as const,
    summary:           '⚠️ MEDIUM (3.5) — 1 arquivo(s) alterado(s), 1 sem teste.',
    overridden:        false,
    createdAt:         new Date(),
  }

  const prisma = {
    guardianReport: {
      create:    overrides.create    ?? jest.fn().mockResolvedValue(fakeReport),
      findFirst: overrides.findFirst ?? jest.fn().mockResolvedValue(null),
      findMany:  jest.fn().mockResolvedValue([fakeReport]),
      update:    overrides.update    ?? jest.fn().mockResolvedValue({ ...fakeReport, overridden: true }),
    },
  }
  const gapDetector = {
    detect:          jest.fn().mockReturnValue([{ sourceFile: 'apps/api-v2/src/auth/auth.service.ts', specFile: 'apps/api-v2/src/auth/__tests__/auth.service.spec.ts', exists: false }]),
    buildSuggestions: jest.fn().mockReturnValue([]),
  }
  const riskScorer = {
    score: jest.fn().mockReturnValue({
      score:          3.5,
      level:          'medium',
      deployRecommend:'review',
      reasons:        ['auth pattern', '1 arquivo sem teste'],
    }),
  }
  const approvalGates = {
    createFromGuardianReport: jest.fn().mockResolvedValue({ required: true, gate: { id: 'gate-1' } }),
  }
  const svc = new GuardianService(prisma as never, gapDetector as never, riskScorer as never, approvalGates as never)
  return { svc, prisma, gapDetector, riskScorer, approvalGates, fakeReport }
}

const dto: GuardianAnalyzeDto = {
  projectId:    'p1',
  repoPath:     '/repo',
  changedFiles: ['apps/api-v2/src/auth/auth.service.ts'],
  allFiles:     ['apps/api-v2/src/auth/auth.service.ts'],
}

describe('GuardianService.analyze', () => {
  it('delega ao gapDetector e riskScorer, persiste report', async () => {
    const { svc, prisma, gapDetector, riskScorer } = buildDeps()

    const report = await svc.analyze(dto)

    expect(gapDetector.detect).toHaveBeenCalledWith(dto.changedFiles, dto.allFiles)
    expect(riskScorer.score).toHaveBeenCalled()
    expect(prisma.guardianReport.create).toHaveBeenCalledTimes(1)
    expect(report.riskLevel).toBe('medium')
    expect(report.id).toBe('r1')
  })

  it('impactedModules extrai o segmento após src/ para cada arquivo alterado', async () => {
    const { svc, prisma } = buildDeps()
    await svc.analyze({
      ...dto,
      changedFiles: ['apps/api-v2/src/auth/auth.service.ts', 'apps/api-v2/src/mission/mission.service.ts'],
    })
    const data = prisma.guardianReport.create.mock.calls[0][0].data as { impactedModules: string[] }
    expect(data.impactedModules).toContain('auth')
    expect(data.impactedModules).toContain('mission')
  })

  it('summary inclui level e score', async () => {
    const { svc } = buildDeps()
    const report = await svc.analyze(dto)
    expect(report.summary).toContain('MEDIUM')
    expect(report.summary).toContain('3.5')
  })

  it('aciona approvalGates.createFromGuardianReport com o score e level do risco', async () => {
    const { svc, approvalGates } = buildDeps()
    const report = await svc.analyze(dto)
    expect(approvalGates.createFromGuardianReport).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'p1', reportId: report.id, riskLevel: 'medium', score: 3.5 }),
    )
  })

  it('não falha o analyze se o approval gate der erro', async () => {
    const { svc, approvalGates } = buildDeps()
    approvalGates.createFromGuardianReport.mockRejectedValueOnce(new Error('boom'))
    await expect(svc.analyze(dto)).resolves.toMatchObject({ id: 'r1' })
  })
})

describe('GuardianService.getLatest', () => {
  it('retorna do cache quando report foi criado recentemente', async () => {
    const { svc, prisma } = buildDeps()
    // analyze escreve o cache; getLatest deve lê-lo sem bater no DB
    await svc.analyze(dto)
    prisma.guardianReport.findFirst.mockClear()

    const report = await svc.getLatest('p1')

    expect(report).not.toBeNull()
    expect(prisma.guardianReport.findFirst).not.toHaveBeenCalled()
  })

  it('consulta o DB quando cache está ausente (projectId diferente)', async () => {
    const fakeDb = { id: 'r-db', riskLevel: 'low', riskScore: 1, deployRecommend: 'safe', summary: 's', overridden: false, createdAt: new Date() }
    const { svc, prisma } = buildDeps({ findFirst: jest.fn().mockResolvedValue(fakeDb) })

    const report = await svc.getLatest('outro-projeto-id')

    expect(prisma.guardianReport.findFirst).toHaveBeenCalled()
    expect(report?.id).toBe('r-db')
  })
})

describe('GuardianService.override', () => {
  it('chama prisma.update com overridden:true e persiste o reason', async () => {
    const { svc, prisma } = buildDeps()

    const result = await svc.override('r1', 'deploy emergencial aprovado')

    expect(prisma.guardianReport.update).toHaveBeenCalledWith({
      where: { id: 'r1' },
      data:  { overridden: true, overrideReason: 'deploy emergencial aprovado' },
    })
    expect(result.overridden).toBe(true)
  })
})
