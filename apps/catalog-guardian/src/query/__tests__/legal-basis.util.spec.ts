import { extractLegalBasis } from '../legal-basis.util'

describe('extractLegalBasis — backlog "LGPD legal/regulatório" (QA-CHECKLIST.md § 12)', () => {
  it('extrai só as tags com prefixo LegalBasis., removendo o prefixo', () => {
    expect(extractLegalBasis(['LegalBasis.Consentimento', 'Tier.Tier1'])).toEqual(['Consentimento'])
  })

  it('múltiplas bases legais: mantém todas', () => {
    expect(extractLegalBasis(['LegalBasis.Consentimento', 'LegalBasis.ObrigacaoLegal'])).toEqual([
      'Consentimento',
      'ObrigacaoLegal',
    ])
  })

  it('nenhuma tag de base legal: lista vazia', () => {
    expect(extractLegalBasis(['Certification.Gold', 'Tier.Tier1'])).toEqual([])
  })

  it('lista de tags vazia: lista vazia, não quebra', () => {
    expect(extractLegalBasis([])).toEqual([])
  })

  it('não confunde prefixo parcial (ex. "LegalBasisX.Foo" sem o ponto) com o prefixo real', () => {
    expect(extractLegalBasis(['LegalBasisX.Foo'])).toEqual([])
  })
})
