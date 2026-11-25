import { ForbiddenException } from '@nestjs/common'
import { KnowledgeGovernanceService } from '../knowledge-governance.service'

const human = { kind: 'human' as const, subject: 'admin', role: 'admin' }
const servicePrincipal = { kind: 'service' as const, subject: 'agent' }

function candidate(overrides: Record<string, unknown> = {}) {
  return {
    id: 'proposal-1', sourceId: 'source-1', scopeKey: 'project:p1', projectId: 'p1',
    logicalKey: 'adr/cache', version: 1, content: 'usar redis', contentHash: 'content-hash',
    knowledgeType: 'decision', sensitivity: 'internal', retentionPolicy: 'indefinite',
    validFrom: null, validUntil: null, producer: 'hermes', producerVersion: '1',
    status: 'candidate', supersedesId: null, createdBy: 'agent', createdAt: new Date(),
    updatedAt: new Date(), canonical: null,
    source: {
      id: 'source-1', sourceIdentity: 'hermes:turn:10', sourceType: 'conversation',
      capturedAt: new Date(),
    },
    ...overrides,
  }
}

function build() {
  const prisma: Record<string, any> = {
    knowledgeSource: {
      createMany: jest.fn().mockResolvedValue({ count: 1 }),
      findUnique: jest.fn().mockResolvedValue(candidate().source),
    },
    knowledgeProposal: {
      // `findUnique` atende duas perguntas diferentes — a chave de idempotência e o dedupe
      // por conteúdo — e um mock que responde igual às duas testaria o caminho errado:
      // devolver a mesma linha para a chave faria o dedupe nunca ser exercido.
      findUnique: jest.fn().mockResolvedValue(null),
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn(),
      create: jest.fn().mockImplementation(({ data }) => Promise.resolve({
        ...candidate(), ...data, status: 'candidate', source: candidate().source,
      })),
      update: jest.fn().mockImplementation(({ data }) => Promise.resolve({
        ...candidate(), ...data, source: candidate().source,
      })),
    },
    knowledgeVersion: {
      findFirst: jest.fn().mockResolvedValue(null),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    knowledgeProjection: {
      upsert: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    knowledgeDecision: { create: jest.fn().mockResolvedValue({}) },
  }
  prisma.$transaction = jest.fn((fn) => fn(prisma))
  prisma.$executeRawUnsafe = jest.fn().mockResolvedValue(0)
  const v1Api = {
    indexContent: jest.fn(),
    deleteDocument: jest.fn().mockResolvedValue(undefined),
  }
  const revisions = { bump: jest.fn(), current: jest.fn().mockReturnValue(0) }
  const service = new KnowledgeGovernanceService(prisma as never, v1Api as never, revisions as never)
  return { service, prisma, v1Api, revisions }
}

const dto = {
  scopeType: 'project' as const,
  projectId: 'p1',
  logicalKey: 'adr/cache',
  content: 'usar redis',
  knowledgeType: 'decision' as const,
  sourceType: 'conversation',
  sourceIdentity: 'hermes:turn:10',
  producer: 'hermes',
  idempotencyKey: 'hermes:captura:10',
}

/** Responde à pergunta do dedupe por conteúdo, nunca à da chave de idempotência. */
function soNoDedupe(prisma: Record<string, any>, linha: unknown) {
  prisma.knowledgeProposal.findUnique.mockImplementation(({ where }: any) =>
    Promise.resolve(where?.sourceId_logicalKey_contentHash ? linha : null))
}

describe('KnowledgeGovernanceService', () => {
  const originalOwner = process.env.KNOWLEDGE_OWNER_SUBJECT

  afterEach(() => {
    if (originalOwner === undefined) delete process.env.KNOWLEDGE_OWNER_SUBJECT
    else process.env.KNOWLEDGE_OWNER_SUBJECT = originalOwner
  })

  it('instala no banco a proteção imutável da fonte', async () => {
    const { service, prisma } = build()
    await service.onModuleInit()

    expect(prisma.$executeRawUnsafe).toHaveBeenCalledTimes(6)
    const sql = prisma.$executeRawUnsafe.mock.calls.flat().join('\n')
    expect(sql).toMatch(/knowledge_sources_immutable/)
    expect(sql).toMatch(/knowledge_decisions_append_only/)
  })

  it('cria candidato com fonte imutável e não o indexa como fato', async () => {
    const { service, prisma, v1Api } = build()
    const result = await service.createProposal(dto, servicePrincipal)

    expect(result.status).toBe('candidate')
    expect(prisma.knowledgeSource.createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: [expect.objectContaining({ scopeKey: 'project:p1', sourceIdentity: 'hermes:turn:10' })],
      skipDuplicates: true,
    }))
    expect(v1Api.indexContent).not.toHaveBeenCalled()
  })

  it('deduplica pela identidade e revisão da fonte, além do conteúdo', async () => {
    const { service, prisma } = build()
    soNoDedupe(prisma, candidate())

    const result = await service.createProposal(dto, servicePrincipal)

    expect(result.id).toBe('proposal-1')
    expect(prisma.knowledgeProposal.create).not.toHaveBeenCalled()
  })

  it('AGENT_TOKEN e outro usuário não podem decidir', async () => {
    const { service, prisma } = build()

    await expect(service.approve('proposal-1', {}, servicePrincipal)).rejects.toBeInstanceOf(ForbiddenException)
    await expect(service.reject('proposal-1', {}, {
      kind: 'human', subject: 'outra-pessoa', role: 'admin',
    })).rejects.toBeInstanceOf(ForbiddenException)
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it('aprovação do dono cria versão canônica antes de projetar no V1', async () => {
    const { service, prisma, v1Api, revisions } = build()
    const proposal = candidate()
    const pending = {
      id: 'knowledge-1', proposalId: proposal.id, sourceId: proposal.sourceId,
      scopeKey: proposal.scopeKey, projectId: proposal.projectId, logicalKey: proposal.logicalKey,
      version: 1, content: proposal.content, contentHash: proposal.contentHash,
      knowledgeType: proposal.knowledgeType, status: 'active', retentionPolicy: 'indefinite',
      validFrom: null, validUntil: null, approvedBy: 'admin', approvedAt: new Date(),
      projections: [{ id: 'projection-1', status: 'pending' }],
    }
    const withSource = { ...pending, proposal: { ...proposal, source: proposal.source } }
    const ready = { ...pending, projections: [{ id: 'projection-1', status: 'ready', externalId: 'doc-1' }] }

    prisma.knowledgeProposal.findUnique.mockResolvedValue(proposal)
    prisma.knowledgeProposal.update.mockResolvedValue({ ...proposal, status: 'approved' })
    prisma.knowledgeVersion.create.mockResolvedValue(pending)
    prisma.knowledgeVersion.findUnique.mockResolvedValue(withSource)
    prisma.knowledgeProjection.upsert.mockResolvedValue({})
    v1Api.indexContent.mockResolvedValue({ id: 'doc-1' })
    prisma.knowledgeVersion.update.mockResolvedValue(ready)

    const result = await service.approve('proposal-1', { reason: 'confirmado' }, human)

    expect(prisma.knowledgeDecision.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      action: 'approve', actorSubject: 'admin', contentHash: 'content-hash',
    }) })
    expect(v1Api.indexContent).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'p1', sourceType: 'approved_knowledge',
      metadata: expect.objectContaining({ lifecycle: 'approved', version: 1, sourceIdentity: 'hermes:turn:10' }),
    }))
    expect(result.canonical.projections[0].status).toBe('ready')
    expect(revisions.bump).toHaveBeenCalledWith('project:p1')
  })

  it('rejeição registra decisão e nunca cria projeção', async () => {
    const { service, prisma, v1Api, revisions } = build()
    prisma.knowledgeProposal.findUnique.mockResolvedValue(candidate())
    prisma.knowledgeProposal.update.mockResolvedValue(candidate({ status: 'rejected' }))

    const result = await service.reject('proposal-1', { reason: 'não confirmado' }, human)

    expect(result.status).toBe('rejected')
    expect(prisma.knowledgeDecision.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'reject' }) })
    expect(v1Api.indexContent).not.toHaveBeenCalled()
    expect(revisions.bump).toHaveBeenCalledWith('project:p1')
  })
})
