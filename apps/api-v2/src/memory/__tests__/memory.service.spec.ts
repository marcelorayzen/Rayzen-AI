import { MemoryService } from '../memory.service'

/**
 * Havia dois escritores na mesma tabela.
 *
 * `MemoryService.store()` e `ProjectMemoryService.index()` faziam upsert em
 * `memory_meta` pela mesma chave `v1DocumentId`, com `update` escrevendo campos
 * diferentes: um gravava `memoryClass` genérico, o outro gravava classe
 * auto-derivada mais `memoryType` e `confidence`. Um `store()` comum rebaixaria
 * para `inbox` uma decisão marcada como `consolidated`, e nada acusaria.
 *
 * Nunca deu problema porque o segundo escritor jamais foi chamado — 0 de 22
 * linhas tinham `memory_type`. Foi removido em 2026-08-15. A Fase 2 mantém o
 * tipo como descrição operacional, sem permitir que ele aprove conteúdo.
 */
describe('MemoryService.store', () => {
  function build() {
    const prisma = {
      memoryMeta: {
        upsert: jest.fn().mockImplementation(({ create }) => Promise.resolve(create)),
      },
}

    const v1Api  = { indexContent: jest.fn().mockResolvedValue({ id: 'doc-1' }) }
    const bridge = { listLearningDocuments: jest.fn().mockResolvedValue([]) }
    const system = { beat: jest.fn().mockResolvedValue(undefined) }
    return { service: new MemoryService(prisma as never, v1Api as never, bridge as never, system as never), prisma, bridge }
  }

  const dadosDoUpsert = (prisma: { memoryMeta: { upsert: jest.Mock } }) =>
    prisma.memoryMeta.upsert.mock.calls[0][0]

  it('decisão operacional nasce inbox e não vira fato sem aprovação', async () => {
    const { service, prisma } = build()

    await service.store({ projectId: 'p1', content: 'usar pgvector', memoryType: 'decision' })

    expect(dadosDoUpsert(prisma).create.memoryClass).toBe('inbox')
    expect(dadosDoUpsert(prisma).create.memoryType).toBe('decision')
  })

  it('constraint operacional também nasce inbox', async () => {
    const { service, prisma } = build()
    await service.store({ projectId: 'p1', content: 'sem any explícito', memoryType: 'constraint' })
    expect(dadosDoUpsert(prisma).create.memoryClass).toBe('inbox')
  })

  it('lesson segue a regra geral — inbox', async () => {
    const { service, prisma } = build()
    await service.store({ projectId: 'p1', content: 'o dist estava velho', memoryType: 'lesson' })
    expect(dadosDoUpsert(prisma).create.memoryClass).toBe('inbox')
  })

  it('classe explícita vence a regra: quem informou sabe mais', async () => {
    const { service, prisma } = build()

    await service.store({
      projectId: 'p1', content: 'x', memoryType: 'decision', memoryClass: 'archive',
    })

    expect(dadosDoUpsert(prisma).create.memoryClass).toBe('archive')
  })

  it('store sem tipo não apaga o tipo já registrado', async () => {
    const { service, prisma } = build()

    await service.store({ projectId: 'p1', content: 'x' })

    // É o cenário exato do conflito antigo: chamada genérica sobre documento que
    // outra chamada já tipou.
    const update = dadosDoUpsert(prisma).update
    expect(update).not.toHaveProperty('memoryType')
    expect(update).not.toHaveProperty('confidence')
  })

  it('propaga confidence e missionId quando informados', async () => {
    const { service, prisma } = build()

    await service.store({
      projectId: 'p1', content: 'x', memoryType: 'lesson', confidence: 0.4, missionId: 'm1',
    })

    expect(dadosDoUpsert(prisma).create).toMatchObject({ confidence: 0.4, missionId: 'm1' })
  })
})

/**
 * Um documento não pode ocupar vários dos 5 slots do contexto injetado.
 *
 * Já havia um dedup por prefixo de conteúdo, mas ele só pega texto idêntico — dois CHUNKS
 * do mesmo arquivo têm conteúdo diferente e passavam os dois. Medido em 2026-08-21 sobre 10
 * consultas reais (docs/memoria-n1-baseline-precisao.md): **9 dos 50 slots** foram para um
 * documento que já estava na lista. `project_memory_ranking.md` apareceu em 4º, 5º e 6º.
 */
describe('MemoryService.search — um documento, uma linha', () => {
  function build(brutos: Array<{ id: string; content: string; score: number; sourcePath?: string | null }>) {
    const prisma = { memoryMeta: { findMany: jest.fn().mockResolvedValue([]), updateMany: jest.fn().mockResolvedValue({}) } }
    const v1Api  = { searchMemoryRaw: jest.fn().mockResolvedValue(brutos.map((b) => ({ projectId: 'p1', ...b }))) }
    const bridge = { listLearningDocuments: jest.fn().mockResolvedValue([]) }
    const system = { beat: jest.fn().mockResolvedValue(undefined) }
    return { service: new MemoryService(prisma as never, v1Api as never, bridge as never, system as never) }
  }

  const chunk = (id: string, sourcePath: string | null, score: number, content = `texto de ${id}`) =>
    ({ id, sourcePath, score, content })

  it('mantém só o melhor pedaço de cada documento', async () => {
    // o caso real: 3 chunks de project_memory_ranking.md entre os primeiros
    const { service } = build([
      chunk('a', 'ranking.md', 0.70),
      chunk('b', 'ranking.md', 0.69),
      chunk('c', 'ranking.md', 0.68),
      chunk('d', 'outro.ts',   0.60),
    ])

    const r = await service.search({ projectId: 'p1', query: 'ranking', limit: 5 })

    expect(r.results.map((x) => x.id)).toEqual(['a', 'd'])
  })

  it('store recusa consolidated: conhecimento canônico exige proposta', async () => {
    const { service } = build([])
    await expect(service.store({
      projectId: 'p1', content: 'x', memoryClass: 'consolidated',
    })).rejects.toThrow(/knowledge\/proposals/)
  })

  it('o pedaço que sobrevive é o de MAIOR score, não o primeiro que apareceu', async () => {
    const { service } = build([
      chunk('fraco', 'doc.md', 0.50),
      chunk('forte', 'doc.md', 0.90),
    ])

    const r = await service.search({ projectId: 'p1', query: 'x', limit: 5 })

    expect(r.results).toHaveLength(1)
    expect(r.results[0].id).toBe('forte')
  })

  it('documentos SEM sourcePath não colapsam num só', async () => {
    // a chave cai no id: sem isso, tudo que não tem caminho viraria uma linha
    const { service } = build([chunk('x', null, 0.7), chunk('y', null, 0.6), chunk('z', null, 0.5)])

    const r = await service.search({ projectId: 'p1', query: 'x', limit: 5 })

    expect(r.results.map((v) => v.id)).toEqual(['x', 'y', 'z'])
  })

  it('libera slot para documento que antes ficava de fora', async () => {
    // com 5 slots: sem dedup sairiam 3 chunks de a.md + b + c; com dedup, 5 documentos
    const { service } = build([
      chunk('a1', 'a.md', 0.90), chunk('a2', 'a.md', 0.89), chunk('a3', 'a.md', 0.88),
      chunk('b',  'b.md', 0.80), chunk('c', 'c.md', 0.70),
      chunk('d',  'd.md', 0.60), chunk('e', 'e.md', 0.50),
    ])

    const r = await service.search({ projectId: 'p1', query: 'x', limit: 5 })

    expect(r.results.map((v) => v.id)).toEqual(['a1', 'b', 'c', 'd', 'e'])
  })
})

describe('MemoryService.search — governança da projeção', () => {
  const source = {
    sourceIdentity: 'adr/cache.md', sourceType: 'file', capturedAt: new Date('2026-09-20T10:00:00Z'),
  }
  const knowledge = (status: string, version: number) => ({
    id: `k${version}`, sourceId: 's1', status, version, knowledgeType: 'decision',
    approvedAt: new Date(`2026-09-2${version}T10:00:00Z`), validFrom: null, validUntil: null,
    proposal: { source },
  })
  const projection = (status: string, version: number, knowledgeStatus = 'active') => ({
    externalId: 'doc-1', status,
    knowledgeVersion: knowledge(knowledgeStatus, version),
  })

  function build(projections: Array<Record<string, unknown>>) {
    const prisma = {
      memoryMeta: {
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({}),
      },
      knowledgeProjection: { findMany: jest.fn().mockResolvedValue(projections) },
    }
    const v1Api = {
      searchMemoryRaw: jest.fn().mockResolvedValue([{
        id: 'doc-1', projectId: 'p1', content: 'usar redis', sourcePath: 'legacy.md',
        score: 0.8, createdAt: new Date('2026-09-19T10:00:00Z'),
      }]),
    }
    const service = new MemoryService(
      prisma as never, v1Api as never,
      { listLearningDocuments: jest.fn() } as never,
      { beat: jest.fn() } as never,
    )
    return { service }
  }

  it('não serve projeção stale ou versão superseded', async () => {
    const { service } = build([projection('stale', 1, 'superseded')])
    const result = await service.search({ projectId: 'p1', query: 'cache' })
    expect(result.results).toEqual([])
  })

  it('quando o V1 deduplica duas versões no mesmo documento, escolhe a canônica ativa', async () => {
    const { service } = build([
      projection('ready', 2, 'active'),
      projection('stale', 1, 'superseded'),
    ])
    const result = await service.search({ projectId: 'p1', query: 'cache' })

    expect(result.results).toHaveLength(1)
    expect(result.results[0]).toMatchObject({
      recordKind: 'knowledge', lifecycle: 'approved', version: 2,
      memoryClass: 'consolidated',
      origin: { sourceIdentity: 'adr/cache.md' },
    })
  })
})
