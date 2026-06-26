import { RiskScorerService } from '../risk-scorer.service'

describe('RiskScorerService', () => {
  let svc: RiskScorerService

  beforeEach(() => { svc = new RiskScorerService() })

  it('retorna low quando sem gaps e arquivos simples', () => {
    const r = svc.score({ changedFiles: ['foo.ts'], testGapCount: 0, suggestions: [], totalChanged: 1 })
    expect(r.level).toBe('low')
    expect(r.deployRecommend).toBe('safe')
  })

  it('sobe para medium com 2+ arquivos sem teste', () => {
    const r = svc.score({ changedFiles: ['a.service.ts', 'b.service.ts'], testGapCount: 2, suggestions: [], totalChanged: 2 })
    expect(r.score).toBeGreaterThanOrEqual(3)
    expect(r.level).not.toBe('low')
  })

  it('retorna critical para whitelist.ts', () => {
    const r = svc.score({
      changedFiles:  ['apps/agent/src/security/whitelist.ts'],
      testGapCount:  0,
      suggestions:   [],
      totalChanged:  1,
    })
    expect(r.level).toBe('critical')
    expect(r.deployRecommend).toBe('block')
  })

  it('retorna medium para arquivo de auth com 1 gap (alto impacto mas escopo pequeno)', () => {
    const r = svc.score({
      changedFiles:  ['apps/api/src/auth/auth.service.ts'],
      testGapCount:  1,
      suggestions:   [],
      totalChanged:  1,
    })
    // base(0.5) + gap(1.5) + auth_high_impact(1.5) = 3.5 → medium
    expect(r.score).toBeCloseTo(3.5, 1)
    expect(['medium', 'high', 'critical']).toContain(r.level)
    expect(r.deployRecommend).toBe('review')
  })

  it('inclui razões no resultado', () => {
    const r = svc.score({ changedFiles: ['x.ts'], testGapCount: 1, suggestions: [], totalChanged: 1 })
    expect(r.reasons.length).toBeGreaterThan(0)
  })
})
