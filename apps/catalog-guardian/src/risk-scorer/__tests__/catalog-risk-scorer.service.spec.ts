import { CatalogRiskScorerService } from '../catalog-risk-scorer.service'
import { CATALOG_RISK_SCORE_TABLE } from '../catalog-risk-score-table.const'

describe('CatalogRiskScorerService', () => {
  let svc: CatalogRiskScorerService

  beforeEach(() => {
    svc = new CatalogRiskScorerService()
  })

  it('retorna low/safe quando nada dispara', () => {
    const r = svc.score({
      requiresCitation: true,
      citedAssetsCount: 1,
      speculativeLanguageDetected: false,
      sensitivityLevelsInContext: ['internal'],
      restrictedFieldsTouched: 0,
    })
    expect(r.score).toBe(0)
    expect(r.level).toBe('low')
    expect(r.recommend).toBe('safe')
    expect(r.signals).toHaveLength(0)
  })

  it('soma semCitacaoQuandoExigida quando resposta exige citação e não cita nada', () => {
    const r = svc.score({
      requiresCitation: true,
      citedAssetsCount: 0,
      speculativeLanguageDetected: false,
      sensitivityLevelsInContext: ['internal'],
      restrictedFieldsTouched: 0,
    })
    expect(r.signals).toContain('semCitacaoQuandoExigida')
    expect(r.score).toBe(CATALOG_RISK_SCORE_TABLE.semCitacaoQuandoExigida)
  })

  it('nao soma semCitacaoQuandoExigida quando pergunta nao exige citacao', () => {
    const r = svc.score({
      requiresCitation: false,
      citedAssetsCount: 0,
      speculativeLanguageDetected: false,
      sensitivityLevelsInContext: ['internal'],
      restrictedFieldsTouched: 0,
    })
    expect(r.signals).not.toContain('semCitacaoQuandoExigida')
  })

  it('soma linguagemEspeculativa quando detectada', () => {
    const r = svc.score({
      requiresCitation: false,
      citedAssetsCount: 1,
      speculativeLanguageDetected: true,
      sensitivityLevelsInContext: ['internal'],
      restrictedFieldsTouched: 0,
    })
    expect(r.signals).toContain('linguagemEspeculativa')
  })

  it('soma misturaDeSensibilidade só quando ha restricted/confidential misturado com outro nivel', () => {
    const misto = svc.score({
      requiresCitation: false,
      citedAssetsCount: 1,
      speculativeLanguageDetected: false,
      sensitivityLevelsInContext: ['internal', 'restricted'],
      restrictedFieldsTouched: 0,
    })
    expect(misto.signals).toContain('misturaDeSensibilidade')

    const homogeneo = svc.score({
      requiresCitation: false,
      citedAssetsCount: 1,
      speculativeLanguageDetected: false,
      sensitivityLevelsInContext: ['restricted'],
      restrictedFieldsTouched: 0,
    })
    expect(homogeneo.signals).not.toContain('misturaDeSensibilidade')
  })

  it('soma campoRestritoTocado quando > 0', () => {
    const r = svc.score({
      requiresCitation: false,
      citedAssetsCount: 1,
      speculativeLanguageDetected: false,
      sensitivityLevelsInContext: ['internal'],
      restrictedFieldsTouched: 2,
    })
    expect(r.signals).toContain('campoRestritoTocado')
  })

  it('score acumulado cruza os thresholds corretamente', () => {
    // semCitacaoQuandoExigida (30) + linguagemEspeculativa (30) = 60 -> high
    const r = svc.score({
      requiresCitation: true,
      citedAssetsCount: 0,
      speculativeLanguageDetected: true,
      sensitivityLevelsInContext: ['internal'],
      restrictedFieldsTouched: 0,
    })
    expect(r.score).toBe(60)
    expect(r.level).toBe('high')
    expect(r.recommend).toBe('review')
  })

  it('score >= 70 vira critical/block', () => {
    // 30 + 30 + 15 = 75
    const r = svc.score({
      requiresCitation: true,
      citedAssetsCount: 0,
      speculativeLanguageDetected: true,
      sensitivityLevelsInContext: ['internal'],
      restrictedFieldsTouched: 3,
    })
    expect(r.score).toBe(75)
    expect(r.level).toBe('critical')
    expect(r.recommend).toBe('block')
  })

  it('nao duplica sinal', () => {
    const r = svc.score({
      requiresCitation: true,
      citedAssetsCount: 0,
      speculativeLanguageDetected: false,
      sensitivityLevelsInContext: ['internal'],
      restrictedFieldsTouched: 0,
    })
    const count = r.signals.filter((s) => s === 'semCitacaoQuandoExigida').length
    expect(count).toBe(1)
  })
})
