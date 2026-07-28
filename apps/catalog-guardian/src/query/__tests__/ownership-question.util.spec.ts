import { isOwnershipQuestion, extractDomainMention, KNOWN_DOMAINS } from '../ownership-question.util'

describe('isOwnershipQuestion', () => {
  it('detecta perguntas de owner/responsável/steward', () => {
    expect(isOwnershipQuestion('Quem é o owner da tabela de pedidos?')).toBe(true)
    expect(isOwnershipQuestion('Quem é o responsável pelo domínio de RH?')).toBe(true)
    expect(isOwnershipQuestion('Qual o steward dessa base?')).toBe(true)
    expect(isOwnershipQuestion('Com quem eu falo sobre a base financeira?')).toBe(true)
  })

  it('nao detecta perguntas de descoberta/semantica/trilha de auditoria', () => {
    expect(isOwnershipQuestion('Quais tabelas existem sobre pedidos?')).toBe(false)
    expect(isOwnershipQuestion('O que significa o termo MRR?')).toBe(false)
    expect(isOwnershipQuestion('Essa tabela contém dado pessoal?')).toBe(false)
    // "quem aprovou" é trilha de auditoria de mudança (OWN-005), não
    // responsabilidade pelo ativo — não deve entrar no fluxo de ownership,
    // que só tem contexto de owner (ver comentário em OWNERSHIP_PATTERNS).
    expect(isOwnershipQuestion('Quem aprovou a última mudança de metadado nessa tabela?')).toBe(false)
  })
})

describe('extractDomainMention', () => {
  it('encontra dominio conhecido case/acento insensitive', () => {
    expect(extractDomainMention('Quem é o steward de RH?')).toBe('rh')
    expect(extractDomainMention('quem cuida do financeiro')).toBe('financeiro')
    expect(extractDomainMention('responsável pelo domínio de Recursos Humanos')).toBe('rh')
  })

  it('retorna null quando nenhum dominio conhecido aparece', () => {
    expect(extractDomainMention('quem é o owner da tabela de pedidos')).toBeNull()
  })

  it('nao da falso positivo por substring dentro de outra palavra', () => {
    // "rh" não deve casar dentro de outra palavra que o contenha
    expect(extractDomainMention('essa tabela tem um campo chamado outrhing')).toBeNull()
  })

  it('aceita lista de dominios customizada', () => {
    expect(extractDomainMention('quem é o dono de logistica', ['logistica'])).toBe('logistica')
  })

  it('cobre todos os dominios conhecidos', () => {
    for (const domain of KNOWN_DOMAINS) {
      expect(extractDomainMention(`quem é responsável pelo domínio ${domain}`)).toBe(domain)
    }
  })
})
