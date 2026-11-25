import { WikiMergeService } from '../wiki-merge.service'

describe('WikiMergeService', () => {
  let service: WikiMergeService

  beforeEach(() => {
    service = new WikiMergeService()
  })

  describe('canOverwrite', () => {
    it('allows overwrite for generated', () => {
      expect(service.canOverwrite('generated')).toBe(true)
    })

    it('allows overwrite for human_reviewed', () => {
      expect(service.canOverwrite('human_reviewed')).toBe(true)
    })

    it('blocks overwrite for human_edited', () => {
      expect(service.canOverwrite('human_edited')).toBe(false)
    })

    it('blocks overwrite for locked', () => {
      expect(service.canOverwrite('locked')).toBe(false)
    })
  })

  describe('computeDiff', () => {
    it('returns "sem alterações" for identical content', () => {
      const md = '## Resumo\nConteúdo.'
      expect(service.computeDiff(md, md)).toBe('sem alterações')
    })

    it('counts added lines', () => {
      const old = '## Resumo\nConteúdo A.'
      const next = '## Resumo\nConteúdo A.\nConteúdo B.'
      const diff = service.computeDiff(old, next)
      expect(diff).toContain('+1 linha')
    })

    it('counts removed lines', () => {
      const old = '## Resumo\nConteúdo A.\nConteúdo B.'
      const next = '## Resumo\nConteúdo A.'
      const diff = service.computeDiff(old, next)
      expect(diff).toContain('-1 linha')
    })
  })

  describe('merge', () => {
    const old = '## Resumo\nVersão antiga.'
    const draft = '## Resumo\nVersão nova com mais detalhes.'

    it('replaces content when editStatus is generated', () => {
      const result = service.merge(old, draft, 'generated')
      expect(result.skipped).toBe(false)
      expect(result.contentMd).toBe(draft)
      expect(result.diff).not.toBe('sem alterações')
    })

    it('skips when editStatus is human_edited', () => {
      const result = service.merge(old, draft, 'human_edited')
      expect(result.skipped).toBe(true)
      expect(result.contentMd).toBe(old)
      expect(result.skipReason).toContain('human_edited')
    })

    it('skips when editStatus is locked', () => {
      const result = service.merge(old, draft, 'locked')
      expect(result.skipped).toBe(true)
    })

    it('allows overwrite with force=true even for human_edited', () => {
      const result = service.merge(old, draft, 'human_edited', true)
      expect(result.skipped).toBe(false)
      expect(result.contentMd).toBe(draft)
    })

    it('skips when draft is identical to current', () => {
      const result = service.merge(old, old, 'generated')
      expect(result.skipped).toBe(true)
      expect(result.skipReason).toBe('sem alterações')
    })
  })
})
