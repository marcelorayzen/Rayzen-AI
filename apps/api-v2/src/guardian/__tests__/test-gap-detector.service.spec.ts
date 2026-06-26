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
        { sourceFile: 'a.service.ts', expectedSpecFile: 'a.spec.ts', exists: false },
        { sourceFile: 'b.service.ts', expectedSpecFile: 'b.spec.ts', exists: true },
      ]
      const suggestions = svc.buildSuggestions(gaps)
      expect(suggestions).toHaveLength(1)
      expect(suggestions[0].file).toBe('a.service.ts')
    })
  })
})
