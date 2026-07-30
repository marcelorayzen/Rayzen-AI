import { CatalogProactiveService } from '../catalog-proactive.service'

interface FakeAsset {
  externalId: string
  name: string
  owner: string | null
  tags: unknown
  firstSyncedAt: Date
}

interface FakeFlag {
  id: string
  reason: string
  flaggedAt: Date
  resolvedAt: Date | null
  queryAudit: { question: string }
}

type FakeRec = Record<string, unknown> & { id: string; dismissedAt: Date | null; dedupeKey?: string | null }

function matchesWhere(rec: FakeRec, where: Record<string, any>): boolean {
  return Object.entries(where).every(([key, cond]) => {
    const value = (rec as any)[key]
    if (cond === null) return value === null
    if (cond !== null && typeof cond === 'object') {
      if ('in' in cond) return cond.in.includes(value)
      if ('notIn' in cond) return !cond.notIn.includes(value)
    }
    return value === cond
  })
}

// Fake Prisma mínimo — só os métodos que CatalogProactiveService usa.
// `initialRecs` simula o que já está gravado em CatalogRecommendation antes
// de getRecommendations() rodar (permite testar cache TTL, stickiness de
// dismiss() e o caso permission_drift-ativo-mas-sem-regra-própria-disparada).
function fakePrisma(opts: {
  assets?: FakeAsset[]
  flags?: FakeFlag[]
  initialRecs?: Array<Record<string, unknown>>
}) {
  const recs: FakeRec[] = (opts.initialRecs ?? []).map((r, i) => ({ id: `rec-${i}`, dismissedAt: null, ...r })) as any

  const deleteMany = jest.fn(async (args: { where: Record<string, any> }) => {
    for (let i = recs.length - 1; i >= 0; i--) {
      if (matchesWhere(recs[i], args.where)) recs.splice(i, 1)
    }
  })
  const upsert = jest.fn(
    async (args: { where: { dedupeKey: string }; create: Record<string, unknown>; update: Record<string, unknown> }) => {
      const existing = recs.find((r) => r.dedupeKey === args.where.dedupeKey)
      if (existing) {
        Object.assign(existing, args.update)
        return existing
      }
      const row: FakeRec = { id: `new-${recs.length}`, dismissedAt: null, ...args.create } as any
      recs.push(row)
      return row
    },
  )
  const update = jest.fn(async (args: { where: { id: string }; data: Record<string, unknown> }) => {
    const row = recs.find((r) => r.id === args.where.id)
    if (row) Object.assign(row, args.data)
    return row
  })
  const findManyAssets = jest.fn(async () => opts.assets ?? [])

  return {
    prisma: {
      catalogRecommendation: {
        findFirst: async () => {
          const active = recs.filter((r) => r.dismissedAt === null)
          if (active.length === 0) return null
          return active.reduce((a, b) => ((a.computedAt as Date) > (b.computedAt as Date) ? a : b))
        },
        findMany: async () => recs.filter((r) => r.dismissedAt === null),
        count: async () => recs.filter((r) => r.dismissedAt === null).length,
        deleteMany,
        upsert,
        update,
      },
      catalogAsset: { findMany: findManyAssets },
      queryAudit: { findMany: async () => [] },
      // Aplica o mesmo filtro que a query real (resolvedAt: null, flaggedAt
      // <= cutoff) — o serviço não refiltra em JS, então o fake precisa
      // respeitar o `where` pra testar o comportamento real.
      queryAuditFlag: {
        findMany: async (args: { where: { resolvedAt: null; flaggedAt: { lte: Date } } }) =>
          (opts.flags ?? []).filter(
            (f) => f.resolvedAt === null && f.flaggedAt.getTime() <= args.where.flaggedAt.lte.getTime(),
          ),
      },
    } as any,
    spies: { deleteMany, upsert, update, findManyAssets },
    recs,
  }
}

// Backdata computedAt de toda linha ativa pra forçar isStale() a recomputar
// no próximo getRecommendations() — sem isto, o cache TTL (30min) esconde
// qualquer mudança feita nos assets/flags entre duas chamadas no teste.
function forceStale(recs: FakeRec[]) {
  for (const r of recs) r.computedAt = new Date(Date.now() - 40 * 60000)
}

describe('CatalogProactiveService', () => {
  it('cache ainda fresco: não recomputa (sem deleteMany/upsert/findMany de assets)', async () => {
    const { prisma, spies } = fakePrisma({
      initialRecs: [{ type: 'all_clear', dedupeKey: 'all_clear', title: 'ok', description: '', priority: 'low', action: null, computedAt: new Date() }],
    })
    const svc = new CatalogProactiveService(prisma)

    const result = await svc.getRecommendations()

    expect(result).toHaveLength(1)
    expect(spies.deleteMany).not.toHaveBeenCalled()
    expect(spies.findManyAssets).not.toHaveBeenCalled()
  })

  it('unclassified_asset: dispara para ativo sem tags há mais de 7 dias, não para ativo recente', async () => {
    const old = new Date(Date.now() - 10 * 86400000)
    const recent = new Date(Date.now() - 1 * 86400000)
    const { prisma } = fakePrisma({
      assets: [
        { externalId: 'a1', name: 'antigo_sem_tag', owner: 'x', tags: [], firstSyncedAt: old },
        { externalId: 'a2', name: 'recente_sem_tag', owner: 'x', tags: [], firstSyncedAt: recent },
      ],
    })
    const svc = new CatalogProactiveService(prisma)

    const result = await svc.getRecommendations()

    const types = result.filter((r) => r.type === 'unclassified_asset').map((r) => r.title)
    expect(types.some((t) => t.includes('antigo_sem_tag'))).toBe(true)
    expect(types.some((t) => t.includes('recente_sem_tag'))).toBe(false)
  })

  it('orphan_owner: dispara para ativo sem owner', async () => {
    const { prisma } = fakePrisma({
      assets: [
        { externalId: 'a1', name: 'sem_owner', owner: null, tags: ['Tier.Tier1'], firstSyncedAt: new Date() },
        { externalId: 'a2', name: 'com_owner', owner: 'steward', tags: ['Tier.Tier1'], firstSyncedAt: new Date() },
      ],
    })
    const svc = new CatalogProactiveService(prisma)

    const result = await svc.getRecommendations()

    const orphanRecs = result.filter((r) => r.type === 'orphan_owner')
    expect(orphanRecs).toHaveLength(1)
    expect(orphanRecs[0].title).toContain('sem_owner')
  })

  it('flagged_unresolved: dispara para flag não resolvida há mais de 3 dias, não para resolvida', async () => {
    const oldUnresolved: FakeFlag = {
      id: 'f1',
      reason: 'resposta errada',
      flaggedAt: new Date(Date.now() - 5 * 86400000),
      resolvedAt: null,
      queryAudit: { question: 'quem é o owner da tabela X?' },
    }
    const oldResolved: FakeFlag = {
      id: 'f2',
      reason: 'outro erro',
      flaggedAt: new Date(Date.now() - 5 * 86400000),
      resolvedAt: new Date(),
      queryAudit: { question: 'outra pergunta' },
    }
    const { prisma } = fakePrisma({ assets: [], flags: [oldUnresolved, oldResolved] })
    const svc = new CatalogProactiveService(prisma)

    const result = await svc.getRecommendations()

    const flaggedRecs = result.filter((r) => r.type === 'flagged_unresolved')
    expect(flaggedRecs).toHaveLength(1)
  })

  it('nenhuma regra própria dispara e não há permission_drift ativo: gera all_clear', async () => {
    const { prisma } = fakePrisma({ assets: [], flags: [] })
    const svc = new CatalogProactiveService(prisma)

    const result = await svc.getRecommendations()

    expect(result).toHaveLength(1)
    expect(result[0].type).toBe('all_clear')
  })

  it('nenhuma regra própria dispara mas HÁ permission_drift ativo: não gera all_clear', async () => {
    const { prisma } = fakePrisma({
      assets: [],
      flags: [],
      initialRecs: [
        {
          type: 'permission_drift',
          title: 'drift',
          description: '',
          priority: 'high',
          action: null,
          computedAt: new Date(Date.now() - 40 * 60000), // stale o suficiente pra forçar recompute
        },
      ],
    })
    const svc = new CatalogProactiveService(prisma)

    const result = await svc.getRecommendations()

    expect(result.some((r) => r.type === 'all_clear')).toBe(false)
    expect(result.some((r) => r.type === 'permission_drift')).toBe(true)
  })

  describe('backlog "dismiss() não-sticky" — dedupeKey + upsert', () => {
    it('dismiss() sobrevive ao próximo compute() enquanto a condição continuar valendo', async () => {
      const asset: FakeAsset = { externalId: 'a1', name: 'sem_owner', owner: null, tags: ['x'], firstSyncedAt: new Date() }
      const { prisma, recs } = fakePrisma({ assets: [asset] })
      const svc = new CatalogProactiveService(prisma)

      const first = await svc.getRecommendations()
      const orphan = first.find((r) => r.type === 'orphan_owner')!
      await svc.dismiss(orphan.id)

      forceStale(recs)
      const second = await svc.getRecommendations()

      expect(second.some((r) => r.type === 'orphan_owner')).toBe(false)
      // A linha dismissada continua existindo (histórico), só não aparece na
      // lista ativa — prova que compute() fez upsert, não delete+create.
      expect(recs.some((r) => r.dedupeKey === 'orphan_owner:a1')).toBe(true)
    })

    it('recomendação dismissada some de vez quando a condição deixa de valer (ativo ganhou owner)', async () => {
      const asset: FakeAsset = { externalId: 'a1', name: 'sem_owner', owner: null, tags: ['x'], firstSyncedAt: new Date() }
      const { prisma, recs } = fakePrisma({ assets: [asset] })
      const svc = new CatalogProactiveService(prisma)

      const first = await svc.getRecommendations()
      const orphan = first.find((r) => r.type === 'orphan_owner')!
      await svc.dismiss(orphan.id)

      asset.owner = 'steward' // condição resolvida
      forceStale(recs)
      await svc.getRecommendations()

      expect(recs.some((r) => r.dedupeKey === 'orphan_owner:a1')).toBe(false)
    })

    it('duas recomendações do mesmo tipo em ativos diferentes não colidem (dedupeKey inclui o alvo)', async () => {
      const { prisma } = fakePrisma({
        assets: [
          { externalId: 'a1', name: 'orfao_1', owner: null, tags: [], firstSyncedAt: new Date() },
          { externalId: 'a2', name: 'orfao_2', owner: null, tags: [], firstSyncedAt: new Date() },
        ],
      })
      const svc = new CatalogProactiveService(prisma)

      const result = await svc.getRecommendations()

      const orphanRecs = result.filter((r) => r.type === 'orphan_owner')
      expect(orphanRecs).toHaveLength(2)
    })

    it('all_clear dismissado é removido (não sobrevive) quando surge uma recomendação real no ciclo seguinte', async () => {
      const { prisma, recs } = fakePrisma({
        assets: [],
        flags: [],
        initialRecs: [
          {
            type: 'all_clear',
            dedupeKey: 'all_clear',
            dismissedAt: new Date(),
            title: 'ok',
            description: '',
            priority: 'low',
            action: null,
            computedAt: new Date(Date.now() - 40 * 60000),
          },
        ],
      })
      const svc = new CatalogProactiveService(prisma)

      // Introduz uma condição real DEPOIS do estado inicial, antes do recompute.
      const asset: FakeAsset = { externalId: 'a1', name: 'sem_owner', owner: null, tags: [], firstSyncedAt: new Date() }
      ;(prisma.catalogAsset.findMany as any) = jest.fn(async () => [asset])

      const result = await svc.getRecommendations()

      expect(recs.some((r) => r.dedupeKey === 'all_clear')).toBe(false)
      expect(result.some((r) => r.type === 'orphan_owner')).toBe(true)
    })
  })
})
