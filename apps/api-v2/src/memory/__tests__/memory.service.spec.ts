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
 * linhas tinham `memory_type`. Foi removido em 2026-08-15 e o que valia dele
 * veio para cá: o campo de tipo e a regra de que decisão não nasce em `inbox`.
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

  it('decisão nasce consolidated, não inbox', async () => {
    const { service, prisma } = build()

    await service.store({ projectId: 'p1', content: 'usar pgvector', memoryType: 'decision' })

    // Em inbox, a decisão competiria por relevância com anotação solta.
    expect(dadosDoUpsert(prisma).create.memoryClass).toBe('consolidated')
    expect(dadosDoUpsert(prisma).create.memoryType).toBe('decision')
  })

  it('constraint também nasce consolidated', async () => {
    const { service, prisma } = build()
    await service.store({ projectId: 'p1', content: 'sem any explícito', memoryType: 'constraint' })
    expect(dadosDoUpsert(prisma).create.memoryClass).toBe('consolidated')
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
