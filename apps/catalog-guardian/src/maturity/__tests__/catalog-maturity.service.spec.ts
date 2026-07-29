import { CatalogMaturityService } from '../catalog-maturity.service'

interface FakeAsset {
  id: string
  owner: string | null
  tags: unknown
  lineageFrom?: Array<{ id: string }>
  lineageTo?: Array<{ id: string }>
}

interface FakeAudit {
  riskLevel: string
  createdAt: Date
}

interface FakeFlag {
  resolvedAt: Date | null
}

interface FakeGate {
  status: string
}

interface FakeRecommendation {
  priority: string
  type: string
  dismissedAt: Date | null
}

// Fake Prisma mínimo — só os métodos que CatalogMaturityService usa, mesmo
// padrão de sync.service.spec.ts/catalog-proactive.service.spec.ts.
function fakePrisma(data: {
  assets?: FakeAsset[]
  audits?: FakeAudit[]
  flags?: FakeFlag[]
  gates?: FakeGate[]
  recommendations?: FakeRecommendation[]
}) {
  const assets = data.assets ?? []
  const audits = data.audits ?? []
  const flags = data.flags ?? []
  const gates = data.gates ?? []
  const recommendations = data.recommendations ?? []

  return {
    catalogAsset: {
      count: async (args?: { where?: { owner?: { not: null } } }) =>
        args?.where?.owner ? assets.filter((a) => a.owner !== null).length : assets.length,
      findMany: async () =>
        assets.map((a) => ({ id: a.id, tags: a.tags, lineageFrom: a.lineageFrom ?? [], lineageTo: a.lineageTo ?? [] })),
    },
    queryAudit: {
      findMany: async (args: { where: { createdAt: { gte: Date } } }) =>
        audits.filter((a) => a.createdAt >= args.where.createdAt.gte).map((a) => ({ riskLevel: a.riskLevel })),
    },
    queryAuditFlag: {
      count: async (args?: { where?: { resolvedAt?: { not: null } } }) =>
        args?.where?.resolvedAt ? flags.filter((f) => f.resolvedAt !== null).length : flags.length,
    },
    reviewGate: {
      count: async (args?: { where?: { status: { in: string[] } } }) =>
        args?.where?.status ? gates.filter((g) => args.where!.status.in.includes(g.status)).length : gates.length,
    },
    catalogRecommendation: {
      findMany: async (args: { where: { type: { not: string } } }) =>
        recommendations
          .filter((r) => r.dismissedAt === null && r.type !== args.where.type.not)
          .map((r) => ({ priority: r.priority })),
    },
  } as any
}

describe('CatalogMaturityService', () => {
  it('catálogo vazio: nenhuma dimensão quebra, mas a banda vira "dados insuficientes" em vez de "otimizado"', async () => {
    const svc = new CatalogMaturityService(fakePrisma({}))
    const report = await svc.computeReport()

    expect(report.overallScore).toBe(100)
    // Item 7: catálogo vazio não pode aparentar "otimizado" — todas as
    // dimensões ficam sem amostra, o override de banda cobre isso.
    expect(report.band).toBe('dados insuficientes')
    for (const d of report.dimensions) {
      expect(Number.isNaN(d.score)).toBe(false)
      expect(d.insufficientData).toBe(true)
    }
  })

  it('só entra "dados insuficientes" quando TODAS as dimensões estão sem amostra — uma sozinha não derruba a banda', async () => {
    const assets: FakeAsset[] = [
      { id: '1', owner: 'a', tags: ['x'] },
      { id: '2', owner: 'a', tags: ['x'] },
      { id: '3', owner: 'a', tags: ['x'] },
    ]
    const svc = new CatalogMaturityService(fakePrisma({ assets }))
    const report = await svc.computeReport()

    const ownership = report.dimensions.find((d) => d.key === 'ownership')!
    const queryQuality = report.dimensions.find((d) => d.key === 'query_quality')!
    expect(ownership.insufficientData).toBe(false) // 3 ativos ≥ MIN_SAMPLE_SIZE
    expect(queryQuality.insufficientData).toBe(true) // zero query registrada
    expect(report.band).not.toBe('dados insuficientes') // nem todas insuficientes
  })

  it('ownership: score reflete % de ativos com owner', async () => {
    const assets: FakeAsset[] = [
      { id: '1', owner: 'a', tags: [] },
      { id: '2', owner: null, tags: [] },
      { id: '3', owner: null, tags: [] },
      { id: '4', owner: null, tags: [] },
    ]
    const svc = new CatalogMaturityService(fakePrisma({ assets }))
    const report = await svc.computeReport()

    const ownership = report.dimensions.find((d) => d.key === 'ownership')!
    expect(ownership.score).toBe(25)
  })

  it('classification: ativo com tags vazio conta como não classificado', async () => {
    const assets: FakeAsset[] = [
      { id: '1', owner: 'a', tags: ['Tier.Tier1'] },
      { id: '2', owner: 'a', tags: [] },
    ]
    const svc = new CatalogMaturityService(fakePrisma({ assets }))
    const report = await svc.computeReport()

    const classification = report.dimensions.find((d) => d.key === 'classification')!
    expect(classification.score).toBe(50)
  })

  it('lineage_coverage: conta ativo com lineageFrom OU lineageTo', async () => {
    const assets: FakeAsset[] = [
      { id: '1', owner: 'a', tags: [], lineageFrom: [{ id: 'e1' }] },
      { id: '2', owner: 'a', tags: [], lineageTo: [{ id: 'e2' }] },
      { id: '3', owner: 'a', tags: [] },
      { id: '4', owner: 'a', tags: [] },
    ]
    const svc = new CatalogMaturityService(fakePrisma({ assets }))
    const report = await svc.computeReport()

    const lineage = report.dimensions.find((d) => d.key === 'lineage_coverage')!
    expect(lineage.score).toBe(50)
  })

  it('query_quality: mistura risco alto com flags resolvidas/pendentes', async () => {
    const audits: FakeAudit[] = [
      { riskLevel: 'low', createdAt: new Date() },
      { riskLevel: 'low', createdAt: new Date() },
      { riskLevel: 'high', createdAt: new Date() },
      { riskLevel: 'critical', createdAt: new Date() },
    ]
    const flags: FakeFlag[] = [{ resolvedAt: new Date() }, { resolvedAt: null }]
    const svc = new CatalogMaturityService(fakePrisma({ audits, flags }))
    const report = await svc.computeReport()

    const quality = report.dimensions.find((d) => d.key === 'query_quality')!
    // riskScore = pct(2 ok de 4) = 50; flagScore = pct(1 resolvida de 2) = 50 → média 50
    expect(quality.score).toBe(50)
  })

  it('governance_process: % de gates decididos (approved/rejected) vs pending', async () => {
    const gates: FakeGate[] = [{ status: 'approved' }, { status: 'rejected' }, { status: 'pending' }, { status: 'pending' }]
    const svc = new CatalogMaturityService(fakePrisma({ gates }))
    const report = await svc.computeReport()

    const process = report.dimensions.find((d) => d.key === 'governance_process')!
    expect(process.score).toBe(50)
  })

  it('governance_debt: recomendação high pesa mais que medium/low, all_clear é ignorada', async () => {
    const recommendations: FakeRecommendation[] = [
      { priority: 'high', type: 'orphan_owner', dismissedAt: null },
      { priority: 'medium', type: 'unclassified_asset', dismissedAt: null },
      { priority: 'low', type: 'all_clear', dismissedAt: null }, // deve ser filtrada (type: not all_clear)
    ]
    const svc = new CatalogMaturityService(fakePrisma({ recommendations }))
    const report = await svc.computeReport()

    const debt = report.dimensions.find((d) => d.key === 'governance_debt')!
    // 100 - (1*15 + 1*8) = 77 — all_clear não entra na penalidade
    expect(debt.score).toBe(77)
    expect(debt.evidence).toMatchObject({ recomendacoesAtivas: 2, high: 1, medium: 1, low: 0 })
  })

  it('overallScore é a média simples das 6 dimensões, arredondada', async () => {
    // 3 ativos (≥ MIN_SAMPLE_SIZE) pra ownership/classification/lineage/
    // governance_debt não ficarem "insuficientes" e derrubarem a banda por
    // engano — o que este teste quer verificar é só a média aritmética.
    const assets: FakeAsset[] = [
      { id: '1', owner: null, tags: [] },
      { id: '2', owner: null, tags: [] },
      { id: '3', owner: null, tags: [] },
    ]
    const svc = new CatalogMaturityService(fakePrisma({ assets }))
    const report = await svc.computeReport()

    expect(report.dimensions).toHaveLength(6)
    // ownership=0, classification=0, lineage=0, resto=100 → 300 / 6 = 50
    expect(report.overallScore).toBe(50)
    expect(report.band).toBe('em desenvolvimento')
  })
})
