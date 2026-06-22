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
    return { service: new ApprovalGatesService(prisma as never), prisma }
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
