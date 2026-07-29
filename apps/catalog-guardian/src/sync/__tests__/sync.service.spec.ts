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

// Fake Prisma — só os métodos que SyncService usa. `existingRow` simula o
// que já está no banco ANTES do sync rodar (null = ativo novo).
function fakePrisma(existingRow: Record<string, unknown> | null) {
  const recommendations: Array<Record<string, unknown>> = []
  return {
    prisma: {
      catalogAsset: {
        findUnique: async () => existingRow,
        upsert: async () => ({ id: 'asset-1' }),
      },
      catalogLineageEdge: { upsert: async () => ({}) },
      catalogGlossaryTerm: { upsert: async () => ({}) },
      catalogRecommendation: {
        create: async (args: { data: Record<string, unknown> }) => {
          recommendations.push(args.data)
          return args.data
        },
      },
    } as any,
    recommendations,
  }
}

describe('SyncService — permission_drift (regra proativa Fase 4)', () => {
  it('ativo novo (sem linha existente): nenhuma recomendação de drift', async () => {
    const { prisma, recommendations } = fakePrisma(null)
    const svc = new SyncService(prisma, fakeAdapter([asset()]))

    await svc.syncOnce()

    expect(recommendations).toHaveLength(0)
  })

  it('ativo existente, domínio e tags iguais: nenhuma recomendação', async () => {
    const { prisma, recommendations } = fakePrisma({ name: 'clientes', domain: 'vendas', tags: [] })
    const svc = new SyncService(prisma, fakeAdapter([asset({ domain: 'vendas', tags: [] })]))

    await svc.syncOnce()

    expect(recommendations).toHaveLength(0)
  })

  it('domínio mudou na fonte: recomendação permission_drift com prioridade high', async () => {
    const { prisma, recommendations } = fakePrisma({ name: 'clientes', domain: 'vendas', tags: [] })
    const svc = new SyncService(prisma, fakeAdapter([asset({ domain: 'financeiro', tags: [] })]))

    await svc.syncOnce()

    expect(recommendations).toHaveLength(1)
    expect(recommendations[0]).toMatchObject({ type: 'permission_drift', priority: 'high' })
  })

  it('só as tags mudaram (domínio igual): recomendação permission_drift com prioridade medium', async () => {
    const { prisma, recommendations } = fakePrisma({ name: 'clientes', domain: 'vendas', tags: ['Tier.Tier1'] })
    const svc = new SyncService(prisma, fakeAdapter([asset({ domain: 'vendas', tags: ['Certification.Gold'] })]))

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
    }

    const { prisma } = fakePrisma(null)
    const svc = new SyncService(prisma, adapter)

    const result = await svc.syncOnce()

    expect(result.edges).toBe(1)
  })
})
