import { classificarResposta } from '../resposta-aprovacao'

/**
 * ── A02 da auditoria de 13/09 ─────────────────────────────────────────────────
 *
 * O loop supervisionado decidia aprovação com duas regexes inline:
 *
 *   if (!reply || /\b(aprovad|continu|ok|sim|pode)\b/i.test(reply))        → APROVOU
 *   else if (/\b(rejeit|corrig|desfa|undo|refaz|errado)\b/i.test(reply))   → REJEITOU
 *   else                                                                   → instrução
 *
 * Três defeitos, medidos contra as expressões literais do arquivo:
 *
 *  1. `!reply` — ausência de resposta entrava no ramo APROVOU. Silêncio autorizava.
 *  2. `\bpode\b` casa dentro de "não pode": a NEGAÇÃO aprovava.
 *  3. E o que a auditoria não registrou: as alternativas são PREFIXOS com `\b` no fim.
 *     `\b` nunca fecha entre `d` e `o`, então "aprovad\b" não casa "aprovado". Resultado
 *     medido: as três opções que o próprio Telegram oferece ao usuário
 *     (`agent-session.service.ts:61`) caíam TODAS em "instrução modificada" — inclusive
 *     "Rejeitar e corrigir", tornando a rejeição inalcançável pelos botões apresentados.
 *
 * Combinados: o silêncio aprovava, "não pode" aprovava, e "Aprovado, continue" não aprovava.
 *
 * A tabela abaixo é o contrato. Os índices entram porque a mensagem do Telegram já numera as
 * opções — número é determinístico, e a regra desta casa é não pedir a quem redige o que tem
 * dono determinístico.
 */
describe('classificarResposta — o que o usuário respondeu, sem adivinhação', () => {
  describe('silêncio nunca é decisão', () => {
    it.each([null, undefined, '', '   ', '\n\t '])('%p → sem_resposta', (entrada) => {
      expect(classificarResposta(entrada as string | null | undefined)).toBe('sem_resposta')
    })
  })

  describe('as opções literais que o sistema oferece são reconhecidas', () => {
    it.each([
      ['Aprovado, continue', 'aprovado'],
      ['Rejeitar e corrigir', 'rejeitado'],
      ['Modificar instrução', 'instrucao'],
      ['Modificar instrucao', 'instrucao'],
    ] as const)('%p → %s', (entrada, esperado) => {
      expect(classificarResposta(entrada)).toBe(esperado)
    })
  })

  describe('índices numerados, como o Telegram os apresenta', () => {
    it.each([
      ['1', 'aprovado'],
      ['2', 'rejeitado'],
      ['3', 'instrucao'],
      ['1.', 'aprovado'],
      [' 2 ', 'rejeitado'],
    ] as const)('%p → %s', (entrada, esperado) => {
      expect(classificarResposta(entrada)).toBe(esperado)
    })
  })

  describe('negação NUNCA aprova — o defeito mais perigoso', () => {
    it.each([
      'não pode',
      'nao pode',
      'não aprovado',
      'nao aprovo',
      'não continue',
      'nunca',
      'de jeito nenhum, não',
    ])('%p não é aprovação', (entrada) => {
      expect(classificarResposta(entrada)).not.toBe('aprovado')
    })
  })

  describe('afirmações comuns aprovam', () => {
    it.each(['ok', 'sim', 'pode', 'aprovado', 'continue', 'segue', 'prossiga', 'Pode continuar', 'beleza'])(
      '%p → aprovado',
      (entrada) => {
        expect(classificarResposta(entrada)).toBe('aprovado')
      },
    )
  })

  describe('rejeições explícitas', () => {
    it.each(['rejeitar', 'corrigir', 'está errado', 'desfaz isso', 'refaz', 'reprovado', 'cancela'])(
      '%p → rejeitado',
      (entrada) => {
        expect(classificarResposta(entrada)).toBe('rejeitado')
      },
    )
  })

  describe('texto livre vira instrução, não aprovação', () => {
    it.each([
      'use outra abordagem, com cache em memória',
      'troque o nome da função para resolverWorkdir',
      'adiciona um teste antes',
    ])('%p → instrucao', (entrada) => {
      expect(classificarResposta(entrada)).toBe('instrucao')
    })
  })
})
