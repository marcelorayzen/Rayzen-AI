import { isProcessQuestion } from '../process-question.util'

describe('isProcessQuestion — backlog "processo/política" (QA-CHECKLIST.md § 12)', () => {
  it('detecta as 4 formas do golden dataset (PRO-001..004)', () => {
    expect(isProcessQuestion('como peço acesso a um dado?')).toBe(true)
    expect(isProcessQuestion('qual o processo pra cadastrar um novo domínio?')).toBe(true)
    expect(isProcessQuestion('quem aprova a criação de um aspect type?')).toBe(true)
    expect(isProcessQuestion('onde está a política de acesso aos dados?')).toBe(true)
  })

  it('variações de fraseado ainda casam (artigo/pronome opcional)', () => {
    expect(isProcessQuestion('como eu solicito acesso a essa base?')).toBe(true)
    expect(isProcessQuestion('qual é o processo de aprovação?')).toBe(true)
    expect(isProcessQuestion('onde fica a política de governança?')).toBe(true)
  })

  it('não detecta perguntas de descoberta/ownership/semântica', () => {
    expect(isProcessQuestion('quais tabelas existem sobre pedidos?')).toBe(false)
    expect(isProcessQuestion('quem é o owner da tabela de pedidos?')).toBe(false)
    expect(isProcessQuestion('o que significa o termo MRR?')).toBe(false)
    // "aprovou" (passado) não é "aprova" (presente, alçada de aprovação) —
    // mesmo cuidado documentado em ownership-question.util.ts pro caso
    // inverso ("quem aprovou" não é ownership).
    expect(isProcessQuestion('quem aprovou a última mudança nessa tabela?')).toBe(false)
  })
})
