import { GovernancePolicyService } from '../governance-policy.service'

// Fake Prisma — só os métodos que GovernancePolicyService usa (mesmo padrão
// de query-audit.service.spec.ts/sync.service.spec.ts).
function fakePrisma(existing: Record<string, unknown> | null = null) {
  const executed: Array<{ sql: string; params: unknown[] }> = []
  const upsertCalls: Array<{ where: unknown; create: unknown; update: unknown }> = []

  const prisma = {
    governancePolicy: {
      findMany: async () => (existing ? [existing] : []),
      upsert: async (args: { where: unknown; create: Record<string, unknown>; update: Record<string, unknown> }) => {
        upsertCalls.push(args)
        return { id: 'policy-1', ...args.create }
      },
    },
    $executeRawUnsafe: async (sql: string, ...params: unknown[]) => {
      executed.push({ sql, params })
      return 1
    },
  }

  return { prisma, executed, upsertCalls }
}

function fakeEmbedding(vector: number[] = [0.1, 0.2, 0.3]) {
  const embed = jest.fn(async () => vector)
  return { embed } as unknown as { embed: (text: string) => Promise<number[]> }
}

describe('GovernancePolicyService — backlog "processo/política" (QA-CHECKLIST.md § 12)', () => {
  it('list(): expõe topic/question/description/documentRef/version, sem domain', async () => {
    const { prisma } = fakePrisma({
      topic: 'pedido_acesso',
      question: 'como peço acesso a um dado?',
      description: 'Abrir chamado no portal de acesso.',
      documentRef: 'https://intranet/politica-acesso',
      version: '2.1',
    })
    const svc = new GovernancePolicyService(prisma as any, fakeEmbedding() as any)

    const [result] = await svc.list()

    expect(result).toEqual({
      topic: 'pedido_acesso',
      question: 'como peço acesso a um dado?',
      description: 'Abrir chamado no portal de acesso.',
      documentRef: 'https://intranet/politica-acesso',
      version: '2.1',
    })
    expect(result).not.toHaveProperty('domain')
  })

  it('create(): embedda topic+question+description e grava via UPDATE ... ::vector', async () => {
    const { prisma, executed } = fakePrisma()
    const embedding = fakeEmbedding([0.5, 0.6])
    const svc = new GovernancePolicyService(prisma as any, embedding as any)

    await svc.create({
      topic: 'pedido_acesso',
      question: 'como peço acesso a um dado?',
      description: 'Abrir chamado no portal de acesso.',
    })

    expect(embedding.embed).toHaveBeenCalledWith('pedido_acesso como peço acesso a um dado? Abrir chamado no portal de acesso.')
    expect(executed).toHaveLength(1)
    expect(executed[0].sql).toContain('::vector')
    expect(executed[0].params[1]).toBe('policy-1')
  })

  it('create(): upsert por topic (re-postar o mesmo topic atualiza, não duplica)', async () => {
    const { prisma, upsertCalls } = fakePrisma()
    const svc = new GovernancePolicyService(prisma as any, fakeEmbedding() as any)

    await svc.create({ topic: 'pedido_acesso', description: 'v1' })

    expect(upsertCalls).toHaveLength(1)
    expect(upsertCalls[0].where).toEqual({ topic: 'pedido_acesso' })
  })
})
