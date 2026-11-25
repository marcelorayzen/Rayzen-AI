import { ConflictException } from '@nestjs/common'
import { Prisma } from '../../../generated/prisma-client-v2'
import { KnowledgeGovernanceService } from '../knowledge-governance.service'
import {
  hashDoPayloadDeCaptura, namespaceDoPrincipal, normalizarPayloadDeCaptura,
} from '../captura-idempotente.const'
import type { CreateKnowledgeProposalDto } from '../dto/knowledge.dto'

const completo: CreateKnowledgeProposalDto = {
  scopeType: 'project',
  projectId: 'p1',
  logicalKey: 'adr/cache',
  idempotencyKey: 'hermes:captura:10',
  content: 'usar redis',
  knowledgeType: 'decision',
  sourceType: 'conversation',
  sourceIdentity: 'hermes:turn:10',
  sourceContent: 'a conversa inteira',
  producer: 'hermes',
  producerVersion: '1.2.0',
  sensitivity: 'internal',
  retentionPolicy: 'indefinite',
  retainUntil: '2027-01-01T00:00:00.000Z',
  validFrom: '2026-09-24T00:00:00.000Z',
  validUntil: '2026-12-31T00:00:00.000Z',
  metadata: { turno: 10, canal: 'telegram' },
}

/**
 * Um valor diferente para cada campo do payload.
 *
 * A cobertura é conferida contra o próprio DTO logo abaixo: campo novo sem mutação aqui
 * reprova. Sem isso, o dia em que alguém acrescentar um campo ao contrato e esquecer de
 * incluí-lo no hash não produziria erro nenhum — produziria replay para payloads
 * diferentes, que é a falha silenciosa que este arquivo existe para impedir.
 */
const MUTACOES: Record<string, unknown> = {
  scopeType: 'personal',
  projectId: 'p2',
  logicalKey: 'adr/outra',
  content: 'usar memcached',
  knowledgeType: 'lesson',
  sourceType: 'documento',
  sourceIdentity: 'hermes:turn:11',
  sourceContent: 'outra conversa',
  producer: 'claude',
  producerVersion: '2.0.0',
  sensitivity: 'secret',
  retentionPolicy: 'short',
  retainUntil: '2028-01-01T00:00:00.000Z',
  validFrom: '2026-09-25T00:00:00.000Z',
  validUntil: '2027-01-31T00:00:00.000Z',
  metadata: { turno: 11, canal: 'telegram' },
}

describe('payload normalizado da captura', () => {
  it('todo campo do contrato entra no hash', () => {
    const base = hashDoPayloadDeCaptura(completo)
    const campos = Object.keys(completo).filter((c) => c !== 'idempotencyKey')

    expect(Object.keys(MUTACOES).sort()).toEqual(campos.sort())

    for (const campo of campos) {
      const mutado = { ...completo, [campo]: MUTACOES[campo] } as CreateKnowledgeProposalDto
      expect({ campo, hash: hashDoPayloadDeCaptura(mutado) }).not.toEqual({ campo, hash: base })
    }
  })

  it('a chave de idempotência não entra no hash do payload', () => {
    const outra = { ...completo, idempotencyKey: 'outra-chave' }
    expect(hashDoPayloadDeCaptura(outra)).toBe(hashDoPayloadDeCaptura(completo))
  })

  it('ordem de chave e grafia do instante são representação, não conteúdo', () => {
    const reordenado: CreateKnowledgeProposalDto = {
      ...completo,
      metadata: { canal: 'telegram', turno: 10 },
      validFrom: '2026-09-24T00:00:00Z',
    }
    expect(hashDoPayloadDeCaptura(reordenado)).toBe(hashDoPayloadDeCaptura(completo))
  })

  it('espaço dentro do conteúdo é conteúdo', () => {
    const comEspaco = { ...completo, content: ' usar redis ' }
    expect(hashDoPayloadDeCaptura(comEspaco)).not.toBe(hashDoPayloadDeCaptura(completo))
  })

  it('mudança dentro do metadata muda o hash', () => {
    // O `stringify` com replacer em forma de array filtraria as chaves de `metadata` por
    // não constarem da lista do topo — este caso é o que separa as duas implementações.
    const outro = { ...completo, metadata: { turno: 10, canal: 'whatsapp' } }
    expect(hashDoPayloadDeCaptura(outro)).not.toBe(hashDoPayloadDeCaptura(completo))
    expect(normalizarPayloadDeCaptura(completo)).toContain('telegram')
  })

  it('campo ausente e campo undefined são o mesmo payload', () => {
    const { producerVersion: _fora, ...semCampo } = completo
    const comUndefined = { ...completo, producerVersion: undefined }
    expect(hashDoPayloadDeCaptura(semCampo as CreateKnowledgeProposalDto))
      .toBe(hashDoPayloadDeCaptura(comUndefined as CreateKnowledgeProposalDto))
  })

  it('o namespace vem do principal, nunca do corpo', () => {
    expect(namespaceDoPrincipal({ kind: 'service', subject: 'agent' })).toBe('service:agent')
    expect(namespaceDoPrincipal({ kind: 'human', subject: 'admin' })).toBe('human:admin')
    expect(namespaceDoPrincipal({ kind: 'service', subject: 'agent' }))
      .not.toBe(namespaceDoPrincipal({ kind: 'service', subject: 'hermes' }))
  })
})

const principal = { kind: 'service' as const, subject: 'agent' }

function build() {
  const prisma: Record<string, any> = {
    knowledgeSource: {
      createMany: jest.fn().mockResolvedValue({ count: 1 }),
      findUnique: jest.fn().mockResolvedValue({ id: 'source-1', sourceIdentity: 'hermes:turn:10' }),
    },
    knowledgeProposal: {
      findUnique: jest.fn().mockResolvedValue(null),
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'proposal-1', ...data })),
    },
    knowledgeVersion: { findFirst: jest.fn().mockResolvedValue(null) },
  }
  prisma.$transaction = jest.fn((fn) => fn(prisma))
  const service = new KnowledgeGovernanceService(prisma as never, {} as never, { bump: jest.fn() } as never)
  return { service, prisma }
}

/** Devolve a linha só quando a pergunta é a da chave de idempotência. */
function chaveJaUsada(prisma: Record<string, any>, linha: unknown) {
  prisma.knowledgeProposal.findUnique.mockImplementation(({ where }: any) =>
    Promise.resolve(where?.namespace_idempotencyKey ? linha : null))
}

describe('KnowledgeGovernanceService — captura idempotente', () => {
  it('grava namespace, chave e hash do payload na criação', async () => {
    const { service, prisma } = build()
    await service.createProposal(completo, principal)

    expect(prisma.knowledgeProposal.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        namespace: 'service:agent',
        idempotencyKey: 'hermes:captura:10',
        payloadHash: hashDoPayloadDeCaptura(completo),
      }),
    }))
  })

  it('a mesma chave com o mesmo payload é replay, sem tocar a fonte imutável', async () => {
    const { service, prisma } = build()
    chaveJaUsada(prisma, { id: 'proposal-1', payloadHash: hashDoPayloadDeCaptura(completo) })

    const result = await service.createProposal(completo, principal) as { id: string; replay?: boolean }

    expect(result.id).toBe('proposal-1')
    expect(result.replay).toBe(true)
    expect(prisma.knowledgeSource.createMany).not.toHaveBeenCalled()
    expect(prisma.knowledgeProposal.create).not.toHaveBeenCalled()
  })

  it('a mesma chave com outro payload é conflito, nunca escolha silenciosa', async () => {
    const { service, prisma } = build()
    chaveJaUsada(prisma, { id: 'proposal-1', payloadHash: hashDoPayloadDeCaptura(completo) })

    const divergente = { ...completo, content: 'usar memcached' }
    await expect(service.createProposal(divergente, principal)).rejects.toBeInstanceOf(ConflictException)
    expect(prisma.knowledgeProposal.create).not.toHaveBeenCalled()
  })

  it('a mesma chave em namespaces diferentes são capturas diferentes', async () => {
    const { service, prisma } = build()
    // A linha só responde à consulta do namespace do serviço; o humano consulta outro par
    // e não encontra nada. Se o namespace viesse do corpo, os dois colidiriam aqui.
    prisma.knowledgeProposal.findUnique.mockImplementation(({ where }: any) => Promise.resolve(
      where?.namespace_idempotencyKey?.namespace === 'service:agent'
        ? { id: 'proposal-1', payloadHash: hashDoPayloadDeCaptura(completo) }
        : null,
    ))

    await service.createProposal(completo, { kind: 'human', subject: 'admin' })

    expect(prisma.knowledgeProposal.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ namespace: 'human:admin' }),
    }))
  })

  it('corrida pela mesma chave resolve pela mesma regra, não em erro de banco', async () => {
    const { service, prisma } = build()
    prisma.knowledgeProposal.create.mockRejectedValue(colisaoUnica(['namespace', 'idempotency_key']))
    // A chave está livre na conferência e ocupada na releitura — é o que acontece quando a
    // outra requisição grava entre as duas. O dedupe por conteúdo responde `null` sempre:
    // sem essa separação o teste passaria pelo caminho do dedupe e nunca exerceria a
    // corrida, que foi o que aconteceu na primeira tentativa deste arquivo.
    let conferencias = 0
    prisma.knowledgeProposal.findUnique.mockImplementation(({ where }: any) => {
      if (!where?.namespace_idempotencyKey) return Promise.resolve(null)
      conferencias += 1
      return Promise.resolve(conferencias === 1
        ? null
        : { id: 'proposal-1', payloadHash: hashDoPayloadDeCaptura(completo) })
    })

    const result = await service.createProposal(completo, principal) as { id: string; replay?: boolean }

    expect(result.id).toBe('proposal-1')
    expect(result.replay).toBe(true)
  })

  it('colisão de OUTRO índice único não vira replay', async () => {
    const { service, prisma } = build()
    const outraColisao = colisaoUnica(['scope_key', 'logical_key', 'version'])
    prisma.knowledgeProposal.create.mockRejectedValue(outraColisao)

    await expect(service.createProposal(completo, principal)).rejects.toBe(outraColisao)
  })
})

function colisaoUnica(target: string[]) {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002', clientVersion: '5.22.0', meta: { target },
  })
}
