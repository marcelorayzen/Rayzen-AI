import { SyncService } from '../sync.service'
import { CatalogAdapter } from '../../adapters/catalog-adapter.interface'
import { RawCatalogAsset } from '../../adapters/catalog-adapter.types'

function fakeAdapter(assets: RawCatalogAsset[]): CatalogAdapter {
  return {
    source: 'openmetadata',
    listAssets: async () => assets,
    getLineage: async () => [],
    listGlossaryTerms: async () => [],
    getUserAccessLevel: async () => 'full',
    getDomainOwner: async () => ({ owner: null }),
    listDomains: async () => [],
  }
}

function asset(overrides: Partial<RawCatalogAsset> = {}): RawCatalogAsset {
  return {
    externalId: 'svc.db.schema.clientes',
    name: 'clientes',
    description: 'Cadastro de clientes',
    owner: 'steward',
    domain: 'vendas',
    sensitivity: 'internal',
    containsPII: false,
    piiFields: [],
    tags: [],
    ...overrides,
  }
}

// Fake EmbeddingService — SyncService só chama .embed(text), nunca a Jina de
// verdade. Vetor fixo, o valor em si não importa pros testes deste arquivo.
function fakeEmbeddingService() {
  return { embed: async () => new Array(1024).fill(0.1) } as any
}

// Fake Prisma — só os métodos que SyncService usa. `existingRow` simula o
// que já está no banco ANTES do sync rodar (null = ativo novo). `embedding:
// null` no retorno de $queryRawUnsafe simula uma linha que ainda não tem
// embedding calculado (self-heal, ver maybeUpdateEmbedding).
function fakePrisma(existingRow: Record<string, unknown> | null) {
  const recommendations: Array<Record<string, unknown>> = []
  return {
    prisma: {
      catalogAsset: {
        findUnique: async () => existingRow,
        upsert: async () => ({ id: 'asset-1' }),
      },
      catalogLineageEdge: { upsert: async () => ({}) },
      catalogGlossaryTerm: {
        findUnique: async () => null,
        upsert: async () => ({ id: 'term-1' }),
      },
      catalogRecommendation: {
        create: async (args: { data: Record<string, unknown> }) => {
          recommendations.push(args.data)
          return args.data
        },
      },
      $queryRawUnsafe: async () => [{ embedding: null }],
      $executeRawUnsafe: async () => 0,
    } as any,
    recommendations,
  }
}

describe('SyncService — permission_drift (regra proativa Fase 4)', () => {
  it('ativo novo (sem linha existente): nenhuma recomendação de drift', async () => {
    const { prisma, recommendations } = fakePrisma(null)
    const svc = new SyncService(prisma, fakeAdapter([asset()]), fakeEmbeddingService())

    await svc.syncOnce()

    expect(recommendations).toHaveLength(0)
  })

  it('ativo existente, domínio e tags iguais: nenhuma recomendação', async () => {
    const { prisma, recommendations } = fakePrisma({ name: 'clientes', domain: 'vendas', tags: [] })
    const svc = new SyncService(prisma, fakeAdapter([asset({ domain: 'vendas', tags: [] })]), fakeEmbeddingService())

    await svc.syncOnce()

    expect(recommendations).toHaveLength(0)
  })

  it('domínio mudou na fonte: recomendação permission_drift com prioridade high', async () => {
    const { prisma, recommendations } = fakePrisma({ name: 'clientes', domain: 'vendas', tags: [] })
    const svc = new SyncService(prisma, fakeAdapter([asset({ domain: 'financeiro', tags: [] })]), fakeEmbeddingService())

    await svc.syncOnce()

    expect(recommendations).toHaveLength(1)
    expect(recommendations[0]).toMatchObject({ type: 'permission_drift', priority: 'high' })
  })

  it('só as tags mudaram (domínio igual): recomendação permission_drift com prioridade medium', async () => {
    const { prisma, recommendations } = fakePrisma({ name: 'clientes', domain: 'vendas', tags: ['Tier.Tier1'] })
    const svc = new SyncService(prisma, fakeAdapter([asset({ domain: 'vendas', tags: ['Certification.Gold'] })]), fakeEmbeddingService())

    await svc.syncOnce()

    expect(recommendations).toHaveLength(1)
    expect(recommendations[0]).toMatchObject({ type: 'permission_drift', priority: 'medium' })
  })
})

describe('SyncService — dedupe de contagem de lineage (item 7)', () => {
  it('a mesma edge A→B aparece na consulta de A (downstream) E de B (upstream) — conta 1 edge, não 2', async () => {
    const assetA = asset({ externalId: 'svc.db.schema.produtos', name: 'produtos' })
    const assetB = asset({ externalId: 'svc.db.schema.estoque', name: 'estoque' })

    // Mesmo padrão do OMD real: getLineage(produtos) devolve a edge como
    // downstream, getLineage(estoque) devolve a MESMA edge como upstream —
    // a origem consultada não importa pro teste, só que a edge se repete.
    const adapter: CatalogAdapter = {
      source: 'openmetadata',
      listAssets: async () => [assetA, assetB],
      getLineage: async () => [{ sourceExternalId: assetA.externalId, targetExternalId: assetB.externalId }],
      listGlossaryTerms: async () => [],
      getUserAccessLevel: async () => 'full',
      getDomainOwner: async () => ({ owner: null }),
      listDomains: async () => [],
    }

    const { prisma } = fakePrisma(null)
    const svc = new SyncService(prisma, adapter, fakeEmbeddingService())

    const result = await svc.syncOnce()

    expect(result.edges).toBe(1)
  })
})

describe('SyncService — embedding (backlog "busca substring")', () => {
  // fakePrisma acima sempre devolve $queryRawUnsafe -> [{embedding: null}],
  // então testes que dependem de "embedding já existe" (não recalcula)
  // precisam de uma variante própria — as duas variáveis abaixo trocam só
  // esse retorno.
  function fakePrismaWithEmbeddingState(existingRow: Record<string, unknown> | null, existingEmbedding: unknown) {
    const { prisma } = fakePrisma(existingRow)
    const executeRawUnsafe = jest.fn(async (..._args: unknown[]) => 0)
    prisma.$queryRawUnsafe = async () => [{ embedding: existingEmbedding }]
    prisma.$executeRawUnsafe = executeRawUnsafe
    return { prisma, executeRawUnsafe }
  }

  it('ativo novo: calcula e grava embedding', async () => {
    const { prisma, executeRawUnsafe } = fakePrismaWithEmbeddingState(null, null)
    const embed = jest.fn(async () => new Array(1024).fill(0.1))
    const svc = new SyncService(prisma, fakeAdapter([asset()]), { embed } as any)

    await svc.syncOnce()

    expect(embed).toHaveBeenCalledTimes(1)
    expect(executeRawUnsafe).toHaveBeenCalledTimes(1)
    expect(executeRawUnsafe.mock.calls[0][0]).toContain('catalog_assets')
  })

  it('conteúdo mudou (description diferente): recalcula embedding mesmo com embedding já existente', async () => {
    const { prisma, executeRawUnsafe } = fakePrismaWithEmbeddingState(
      { name: 'clientes', description: 'descrição antiga', domain: 'vendas', tags: [] },
      '[0.1,0.2]',
    )
    const embed = jest.fn(async () => new Array(1024).fill(0.1))
    const svc = new SyncService(prisma, fakeAdapter([asset({ description: 'descrição nova' })]), { embed } as any)

    await svc.syncOnce()

    expect(embed).toHaveBeenCalledTimes(1)
  })

  it('conteúdo igual e embedding já existe: NÃO recalcula (evita chamada desnecessária à Jina)', async () => {
    const { prisma, executeRawUnsafe } = fakePrismaWithEmbeddingState(
      { name: 'clientes', description: 'Cadastro de clientes', domain: 'vendas', tags: [] },
      '[0.1,0.2]',
    )
    const embed = jest.fn(async () => new Array(1024).fill(0.1))
    const svc = new SyncService(prisma, fakeAdapter([asset()]), { embed } as any)

    await svc.syncOnce()

    expect(embed).not.toHaveBeenCalled()
    expect(executeRawUnsafe).not.toHaveBeenCalled()
  })

  it('conteúdo igual mas embedding ainda não existe (self-heal pós-migration): calcula', async () => {
    const { prisma, executeRawUnsafe } = fakePrismaWithEmbeddingState(
      { name: 'clientes', description: 'Cadastro de clientes', domain: 'vendas', tags: [] },
      null,
    )
    const embed = jest.fn(async () => new Array(1024).fill(0.1))
    const svc = new SyncService(prisma, fakeAdapter([asset()]), { embed } as any)

    await svc.syncOnce()

    expect(embed).toHaveBeenCalledTimes(1)
    expect(executeRawUnsafe).toHaveBeenCalledTimes(1)
  })

  it('Jina falha: sync não quebra, só loga o erro (mesmo padrão de getLineage/listGlossaryTerms)', async () => {
    const { prisma } = fakePrismaWithEmbeddingState(null, null)
    const embed = jest.fn(async () => {
      throw new Error('Jina API erro (HTTP 403): Insufficient account balance')
    })
    const svc = new SyncService(prisma, fakeAdapter([asset()]), { embed } as any)

    await expect(svc.syncOnce()).resolves.toMatchObject({ assets: 1 })
  })
})
