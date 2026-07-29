import { QueryAuditService, RecordQueryAuditDto } from '../query-audit.service'

function baseDto(overrides: Partial<RecordQueryAuditDto> = {}): RecordQueryAuditDto {
  return {
    userId: 'geral',
    profile: 'geral',
    question: 'quem é o owner da tabela de pedidos?',
    answer: 'O owner é o steward.',
    restrictedFieldsOmitted: [],
    citedAssets: ['catalog_guardian_demo.rayzen_ai.public.pedidos'],
    riskScore: 0,
    riskLevel: 'low',
    gateRequired: false,
    ...overrides,
  }
}

// Fake Prisma — só os métodos que QueryAuditService usa (mesmo padrão de
// sync.service.spec.ts). queryAudit nunca recebe `update` no fake de propósito:
// se o service algum dia tentar mutar o registro original, o teste quebra por
// "não é uma função" em vez de silenciosamente permitir a regressão.
function fakePrisma() {
  const created: Array<Record<string, unknown>> = []
  const flagsCreated: Array<Record<string, unknown>> = []
  const flagsUpdated: Array<{ where: Record<string, unknown>; data: Record<string, unknown> }> = []

  return {
    prisma: {
      queryAudit: {
        create: async (args: { data: Record<string, unknown> }) => {
          created.push(args.data)
          return { id: 'audit-1', ...args.data }
        },
        findMany: async (args: { where?: { userId?: string } }) => {
          return [{ id: 'audit-1', userId: args.where?.userId ?? 'geral' }]
        },
      },
      queryAuditFlag: {
        create: async (args: { data: Record<string, unknown> }) => {
          flagsCreated.push(args.data)
          return { id: 'flag-1', resolvedAt: null, ...args.data }
        },
        update: async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
          flagsUpdated.push(args)
          return { id: args.where.id, ...args.data }
        },
      },
    } as any,
    created,
    flagsCreated,
    flagsUpdated,
  }
}

describe('QueryAuditService', () => {
  it('record() grava o registro append-only via queryAudit.create', async () => {
    const { prisma, created } = fakePrisma()
    const svc = new QueryAuditService(prisma)

    await svc.record(baseDto())

    expect(created).toHaveLength(1)
    expect(created[0]).toMatchObject({ userId: 'geral', riskLevel: 'low' })
  })

  it('history() filtra por userId quando informado', async () => {
    const { prisma } = fakePrisma()
    const svc = new QueryAuditService(prisma)

    const rows = await svc.history('financeiro')

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ userId: 'financeiro' })
  })

  it('flag() cria um QueryAuditFlag — nunca atualiza o QueryAudit original', async () => {
    const { prisma, flagsCreated } = fakePrisma()
    const svc = new QueryAuditService(prisma)

    await svc.flag('audit-1', 'resposta inventou um owner que não existe')

    expect(flagsCreated).toHaveLength(1)
    expect(flagsCreated[0]).toMatchObject({
      queryAuditId: 'audit-1',
      reason: 'resposta inventou um owner que não existe',
    })
  })

  it('resolveFlag() atualiza só a flag (resolvedAt), não o QueryAudit', async () => {
    const { prisma, flagsUpdated } = fakePrisma()
    const svc = new QueryAuditService(prisma)

    await svc.resolveFlag('flag-1')

    expect(flagsUpdated).toHaveLength(1)
    expect(flagsUpdated[0].where).toEqual({ id: 'flag-1' })
    expect(flagsUpdated[0].data.resolvedAt).toBeInstanceOf(Date)
  })
})
