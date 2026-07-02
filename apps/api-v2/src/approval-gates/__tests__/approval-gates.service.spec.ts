import { ApprovalGatesService } from '../approval-gates.service'

/**
 * Sem isso, checkAndCreate() criava um gate 'pending' novo a cada chamada, mesmo
 * já existindo um 'approved' para o mesmo step+skill — toda aprovação só deixava a
 * missão tentar de novo (specialist reiniciado do zero) e cair noutro gate pending,
 * nunca deixando a ação de risco medium/high de fato executar.
 */
describe('ApprovalGatesService.checkAndCreate — reaproveita gate já aprovado', () => {
  function buildService(approvedGate: unknown) {
    const prisma = {
      approvalGate: {
        findFirst: jest.fn().mockResolvedValue(approvedGate),
        create:    jest.fn().mockResolvedValue({ id: 'new-gate', status: 'pending' }),
      },
    }
    const events   = { approvalGate: jest.fn() }
    const missions = {} as never
    return { service: new ApprovalGatesService(prisma as never, events as never, missions), prisma }
  }

  it('não cria gate novo quando já existe um approved para o mesmo step+skill', async () => {
    const { service, prisma } = buildService({ id: 'g-old', status: 'approved' })

    const result = await service.checkAndCreate(
      'medium', 'p1', 'm1', 's1', 'Skill X requires approval', { skillId: 'jarvis:run_command', input: {} },
    )

    expect(result.required).toBe(false)
    expect(prisma.approvalGate.create).not.toHaveBeenCalled()
  })

  it('cria gate novo quando não há approved anterior pro mesmo step+skill', async () => {
    const { service, prisma } = buildService(null)

    const result = await service.checkAndCreate(
      'medium', 'p1', 'm1', 's1', 'Skill X requires approval', { skillId: 'jarvis:run_command', input: {} },
    )

    expect(result.required).toBe(true)
    expect(prisma.approvalGate.create).toHaveBeenCalledTimes(1)
  })
})

describe('ApprovalGatesService.createFromGuardianReport', () => {
  function buildService(pendingGuardianGates: unknown[] = []) {
    const pendingGate = { id: 'gate-1', status: 'pending', projectId: 'p1', type: 'guardian_review', missionId: null }
    const prisma = {
      approvalGate: {
        create:      jest.fn().mockResolvedValue(pendingGate),
        updateMany:  jest.fn().mockResolvedValue({ count: 1 }),
        findUnique:  jest.fn().mockResolvedValue({ ...pendingGate, status: 'rejected' }),
        findMany:    jest.fn().mockResolvedValue(pendingGuardianGates),
      },
    }
    const events   = { approvalGate: jest.fn() }
    const missions = {} as never
    return { service: new ApprovalGatesService(prisma as never, events as never, missions), prisma }
  }

  it('não cria gate quando riskLevel é low', async () => {
    const { service, prisma } = buildService()
    const result = await service.createFromGuardianReport({
      projectId: 'p1', reportId: 'r1', riskLevel: 'low', score: 10, summary: 'ok',
    })
    expect(result.required).toBe(false)
    expect(prisma.approvalGate.create).not.toHaveBeenCalled()
  })

  it('cria gate pendente (guardian_review, riskLevel medium) quando riskLevel é medium', async () => {
    const { service, prisma } = buildService()
    const result = await service.createFromGuardianReport({
      projectId: 'p1', reportId: 'r1', riskLevel: 'medium', score: 45, summary: 'gap de teste',
    })
    expect(result.required).toBe(true)
    const data = prisma.approvalGate.create.mock.calls[0][0].data
    expect(data.type).toBe('guardian_review')
    expect(prisma.approvalGate.updateMany).not.toHaveBeenCalled()
  })

  it('cria gate pendente (irreversible) quando riskLevel é high', async () => {
    const { service, prisma } = buildService()
    await service.createFromGuardianReport({
      projectId: 'p1', reportId: 'r1', riskLevel: 'high', score: 70, summary: 'modulo critico',
    })
    const data = prisma.approvalGate.create.mock.calls[0][0].data
    expect(data.type).toBe('guardian_review')
  })

  it('expira gate Guardian pendente anterior antes de criar o novo (dedupe)', async () => {
    const staleGate = {
      id: 'gate-old', status: 'pending', projectId: 'p1', type: 'guardian_review',
      context: { guardianReportId: 'r-old' },
    }
    const { service, prisma } = buildService([staleGate])

    await service.createFromGuardianReport({
      projectId: 'p1', reportId: 'r-new', riskLevel: 'medium', score: 45, summary: 'gap de teste',
    })

    expect(prisma.approvalGate.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ['gate-old'] }, status: 'pending' },
        data:  expect.objectContaining({ status: 'expired', approvedBy: 'guardian-system' }),
      }),
    )
    expect(prisma.approvalGate.create).toHaveBeenCalledTimes(1)
  })

  it('não expira gates pendentes que não vieram do Guardian', async () => {
    const humanGate = {
      id: 'gate-human', status: 'pending', projectId: 'p1', type: 'irreversible',
      context: { skillId: 'jarvis:run_command' },
    }
    const { service, prisma } = buildService([humanGate])

    await service.createFromGuardianReport({
      projectId: 'p1', reportId: 'r-new', riskLevel: 'medium', score: 45, summary: 'gap de teste',
    })

    const expiredCalls = prisma.approvalGate.updateMany.mock.calls.filter(
      (c: [{ data?: { status?: string } }]) => c[0]?.data?.status === 'expired',
    )
    expect(expiredCalls).toHaveLength(0)
  })

  it('cria e rejeita automaticamente quando riskLevel é critical', async () => {
    const { service, prisma } = buildService()
    const result = await service.createFromGuardianReport({
      projectId: 'p1', reportId: 'r1', riskLevel: 'critical', score: 90, summary: 'schema + auth sem teste',
    })
    expect(prisma.approvalGate.create).toHaveBeenCalledTimes(1)
    expect(prisma.approvalGate.create.mock.calls[0][0].data.type).toBe('irreversible')
    expect(prisma.approvalGate.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'gate-1', status: 'pending' } }),
    )
    expect(result.required).toBe(true)
    expect(result.gate?.status).toBe('rejected')
  })
})
