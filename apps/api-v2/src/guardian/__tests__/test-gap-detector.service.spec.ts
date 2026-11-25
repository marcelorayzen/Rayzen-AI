import { TestGapDetectorService } from '../test-gap-detector.service'

describe('TestGapDetectorService', () => {
  let svc: TestGapDetectorService

  beforeEach(() => { svc = new TestGapDetectorService() })

  describe('detect()', () => {
    it('retorna gap para service sem spec', () => {
      const gaps = svc.detect(
        ['apps/api-v2/src/guardian/guardian.service.ts'],
        [],
      )
      expect(gaps).toHaveLength(1)
      expect(gaps[0].exists).toBe(false)
      expect(gaps[0].expectedSpecFile).toContain('__tests__/guardian.service.spec.ts')
    })

    it('marca exists=true quando spec está na lista de arquivos', () => {
      const gaps = svc.detect(
        ['apps/api-v2/src/guardian/guardian.service.ts'],
        ['apps/api-v2/src/guardian/__tests__/guardian.service.spec.ts'],
      )
      expect(gaps[0].exists).toBe(true)
    })

    it('ignora arquivos não-testáveis (.module.ts, .dto.ts, index.ts)', () => {
      const gaps = svc.detect(
        ['apps/api-v2/src/guardian/guardian.module.ts', 'apps/api-v2/src/guardian/index.ts'],
        [],
      )
      expect(gaps).toHaveLength(0)
    })

    it('detecta gap em controller', () => {
      const gaps = svc.detect(
        ['apps/api-v2/src/guardian/guardian.controller.ts'],
        [],
      )
      expect(gaps).toHaveLength(1)
      expect(gaps[0].expectedSpecFile).toContain('guardian.controller.spec.ts')
    })
  })

  describe('buildSuggestions()', () => {
    it('só inclui gaps sem spec', () => {
      const gaps = [
        { sourceFile: 'a.service.ts', expectedSpecFile: 'a.spec.ts', exists: false, type: 'service' as const, reason: 'missing_spec' as const },
        { sourceFile: 'b.service.ts', expectedSpecFile: 'b.spec.ts', exists: true,  type: 'service' as const, reason: 'no_coverage' as const },
      ]
      const suggestions = svc.buildSuggestions(gaps)
      expect(suggestions).toHaveLength(1)
      expect(suggestions[0].file).toBe('a.service.ts')
    })
  })

  describe('type e reason discriminados', () => {
    it('service sem spec → type=service, reason=missing_spec', () => {
      const gaps = svc.detect(['apps/api-v2/src/guardian/guardian.service.ts'], [])
      expect(gaps[0].type).toBe('service')
      expect(gaps[0].reason).toBe('missing_spec')
    })

    it('service com spec → type=service, reason=no_coverage', () => {
      const gaps = svc.detect(
        ['apps/api-v2/src/guardian/guardian.service.ts'],
        ['apps/api-v2/src/guardian/__tests__/guardian.service.spec.ts'],
      )
      expect(gaps[0].type).toBe('service')
      expect(gaps[0].reason).toBe('no_coverage')
    })

    it('controller → type=controller', () => {
      const gaps = svc.detect(['apps/api-v2/src/guardian/guardian.controller.ts'], [])
      expect(gaps[0].type).toBe('controller')
    })

    it('gateway → type=service', () => {
      const gaps = svc.detect(['apps/api-v2/src/events/events.gateway.ts'], [])
      expect(gaps[0].type).toBe('service')
    })
  })
})
