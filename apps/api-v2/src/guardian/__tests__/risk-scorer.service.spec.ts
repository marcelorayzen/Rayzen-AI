import { RiskScorerService } from '../risk-scorer.service'
import { RISK_SCORE_TABLE } from '../risk-score-table.const'

describe('RiskScorerService', () => {
  let svc: RiskScorerService

  beforeEach(() => { svc = new RiskScorerService() })

  it('retorna low (0) quando sem gaps e arquivos simples', () => {
    const r = svc.score({ changedFiles: ['foo.ts'], testGapCount: 0, suggestions: [], totalChanged: 1 })
    expect(r.score).toBe(0)
    expect(r.level).toBe('low')
    expect(r.deployRecommend).toBe('safe')
    expect(r.signals).toHaveLength(0)
  })

  it('soma serviceSemSpec (30) para arquivos sem spec', () => {
    const r = svc.score({ changedFiles: ['a.service.ts'], testGapCount: 1, suggestions: [], totalChanged: 1 })
    expect(r.score).toBe(RISK_SCORE_TABLE.serviceSemSpec)
    expect(r.signals).toContain('serviceSemSpec')
    expect(r.level).toBe('medium')
    expect(r.deployRecommend).toBe('review')
  })

  it('soma moduloCritico (25) para mudanca em auth', () => {
    const r = svc.score({
      changedFiles: ['apps/api-v2/src/auth/auth.service.ts'],
      testGapCount: 0,
      suggestions:  [],
      totalChanged: 1,
    })
    expect(r.score).toBe(RISK_SCORE_TABLE.moduloCritico)
    expect(r.signals).toContain('moduloCritico')
    expect(r.level).toBe('low') // 25 < 30
  })

  it('soma moduloCritico para gateway', () => {
    const r = svc.score({
      changedFiles: ['apps/api-v2/src/gateway/events.gateway.ts'],
      testGapCount: 0,
      suggestions:  [],
      totalChanged: 1,
    })
    expect(r.signals).toContain('moduloCritico')
  })

  it('nao marca moduloCritico por substring: author, webhook e hooks React', () => {
    const r = svc.score({
      changedFiles: [
        'apps/web/src/components/author-card.tsx',
        'apps/api/src/modules/webhook/webhook.service.ts',
        'apps/web/src/hooks/useGoalGraph.ts',
      ],
      testGapCount: 0,
      suggestions:  [],
      totalChanged: 3,
    })
    expect(r.signals).not.toContain('moduloCritico')
  })

  it('marca moduloCritico para policy-engine, whitelist e hooks do agent', () => {
    for (const file of [
      'apps/api-v2/src/policy-engine/policy-engine.controller.ts',
      'apps/agent/src/security/whitelist.ts',
      'apps/agent/src/hooks/rayzen-context-hook.mjs',
    ]) {
      const r = svc.score({ changedFiles: [file], testGapCount: 0, suggestions: [], totalChanged: 1 })
      expect(r.signals).toContain('moduloCritico')
    }
  })

  it('soma alteracaoSchema (20) para mudanca no schema.prisma', () => {
    const r = svc.score({
      changedFiles: ['apps/api-v2/prisma/schema.prisma'],
      testGapCount: 0,
      suggestions:  [],
      totalChanged: 1,
    })
    expect(r.signals).toContain('alteracaoSchema')
    expect(r.score).toBe(RISK_SCORE_TABLE.alteracaoSchema)
  })

  it('soma migrationSemTeste (20) para migration sem spec', () => {
    const r = svc.score({
      changedFiles: ['apps/api-v2/prisma/migrations/20260627_guardian/migration.sql'],
      testGapCount: 0,
      suggestions:  [],
      totalChanged: 1,
    })
    expect(r.signals).toContain('migrationSemTeste')
    expect(r.score).toBe(RISK_SCORE_TABLE.migrationSemTeste)
  })

  it('nao soma migrationSemTeste quando ha spec de migration', () => {
    const r = svc.score({
      changedFiles: [
        'apps/api-v2/prisma/migrations/20260627_guardian/migration.sql',
        'apps/api-v2/prisma/__tests__/migration.spec.ts',
      ],
      testGapCount: 0,
      suggestions:  [],
      totalChanged: 2,
    })
    expect(r.signals).not.toContain('migrationSemTeste')
  })

  it('soma jwtProximoDeExpirar (10) quando JWT expira em <= 7 dias', () => {
    const r = svc.score({
      changedFiles:      ['foo.ts'],
      testGapCount:      0,
      suggestions:       [],
      totalChanged:      1,
      jwtExpiresInDays:  5,
    })
    expect(r.signals).toContain('jwtProximoDeExpirar')
    expect(r.score).toBe(RISK_SCORE_TABLE.jwtProximoDeExpirar)
  })

  it('nao soma jwtProximoDeExpirar quando JWT expira em > 7 dias', () => {
    const r = svc.score({
      changedFiles:      ['foo.ts'],
      testGapCount:      0,
      suggestions:       [],
      totalChanged:      1,
      jwtExpiresInDays:  30,
    })
    expect(r.signals).not.toContain('jwtProximoDeExpirar')
  })

  it('score acumulado: serviceSemSpec + moduloCritico = 55 (medium)', () => {
    const r = svc.score({
      changedFiles: ['apps/api/src/auth/auth.service.ts'],
      testGapCount: 1,
      suggestions:  [],
      totalChanged: 1,
    })
    expect(r.score).toBe(RISK_SCORE_TABLE.serviceSemSpec + RISK_SCORE_TABLE.moduloCritico)
    expect(r.level).toBe('medium') // 55 < 60
  })

  it('score acumulado: serviceSemSpec + moduloCritico + alteracaoSchema >= 85 → critical', () => {
    const r = svc.score({
      changedFiles: [
        'apps/api-v2/src/auth/auth.service.ts',
        'apps/api-v2/prisma/schema.prisma',
      ],
      testGapCount: 1,
      suggestions:  [],
      totalChanged: 2,
    })
    // 30 + 25 + 20 = 75 → high (nao critical porque nao atingiu 85)
    expect(r.score).toBe(75)
    expect(r.level).toBe('high')
    expect(r.deployRecommend).toBe('review')
  })

  it('inclui recommendations no resultado', () => {
    const r = svc.score({ changedFiles: ['x.service.ts'], testGapCount: 1, suggestions: [], totalChanged: 1 })
    expect(r.recommendations.length).toBeGreaterThan(0)
  })

  it('nao duplica sinal mesmo que o mesmo criterio apareca multiplas vezes', () => {
    const r = svc.score({
      changedFiles: [
        'apps/api-v2/src/auth/auth.service.ts',
        'apps/api-v2/src/auth/auth.controller.ts',
      ],
      testGapCount: 0,
      suggestions:  [],
      totalChanged: 2,
    })
    const critCount = r.signals.filter(s => s === 'moduloCritico').length
    expect(critCount).toBe(1)
    expect(r.score).toBe(RISK_SCORE_TABLE.moduloCritico)
  })
})

// ─── Sinais que saíram de "reservado" em 2026-08-13 ──────────────────────────
//
// Estavam declarados na RISK_SCORE_TABLE mas nunca alimentados, então o score era
// binário disfarçado de número: `serviceSemSpec` sozinho crava 30, que é o limiar
// de medium. Alimentá-los é o que faz "MEDIUM 30" e "MEDIUM 55" significarem
// coisas diferentes.

describe('RiskScorerService — semTesteRodado', () => {
  const svc = new RiskScorerService()
  const base = { changedFiles: ['a.ts'], testGapCount: 0, suggestions: [], totalChanged: 1 }

  it('não avalia o sinal quando o caller não sabe (undefined)', () => {
    const r = svc.score({ ...base, horasDesdeUltimoTeste: undefined })
    expect(r.signals).not.toContain('semTesteRodado')
  })

  it('não pontua quando houve execução recente', () => {
    const r = svc.score({ ...base, horasDesdeUltimoTeste: 1.5 })
    expect(r.signals).not.toContain('semTesteRodado')
  })

  it('pontua quando a última execução passou do limite', () => {
    const r = svc.score({ ...base, horasDesdeUltimoTeste: 9 })
    expect(r.signals).toContain('semTesteRodado')
    expect(r.score).toBe(RISK_SCORE_TABLE.semTesteRodado)
    expect(r.reasons.join(' ')).toContain('9h')
  })

  it('pontua quando nunca houve execução (null)', () => {
    const r = svc.score({ ...base, horasDesdeUltimoTeste: null })
    expect(r.signals).toContain('semTesteRodado')
    expect(r.reasons.join(' ')).toContain('Nenhuma execução')
  })
})

describe('RiskScorerService — docDesatualizada', () => {
  const svc = new RiskScorerService()
  const base = { testGapCount: 0, suggestions: [], totalChanged: 1 }

  it('acusa quando a fonte do gerador muda e o doc não é regerado', () => {
    const r = svc.score({ ...base, changedFiles: ['apps/agent/src/actions/git.ts'] })
    expect(r.signals).toContain('docDesatualizada')
    expect(r.recommendations.join(' ')).toContain('pnpm gen:catalog')
  })

  it('não acusa quando o doc vem no mesmo changeset', () => {
    const r = svc.score({
      ...base,
      changedFiles: ['apps/agent/src/actions/git.ts', 'docs/agent-actions.md'],
    })
    expect(r.signals).not.toContain('docDesatualizada')
  })

  it('acusa mudança na whitelist do agent', () => {
    const r = svc.score({ ...base, changedFiles: ['apps/agent/src/security/whitelist.ts'] })
    expect(r.signals).toContain('docDesatualizada')
  })

  it('ignora arquivo que não alimenta doc gerado', () => {
    const r = svc.score({ ...base, changedFiles: ['apps/api-v2/src/foo/bar.ts'] })
    expect(r.signals).not.toContain('docDesatualizada')
  })

  it('normaliza barra invertida do Windows', () => {
    // O watcher roda no Windows e pode mandar path com barra invertida.
    const windows = ['apps', 'agent', 'src', 'actions', 'git.ts'].join('\\')
    const r = svc.score({ ...base, changedFiles: [windows] })
    expect(r.signals).toContain('docDesatualizada')
  })
})
