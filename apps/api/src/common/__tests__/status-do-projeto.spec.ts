import { readFileSync } from 'fs'
import { join } from 'path'
import {
  STATUS_DE_PROJETO, STATUS_QUE_OS_CICLOS_VARREM, ehStatusValido, ehVarridoPorCiclos,
} from '../status-do-projeto.const'
import { PROJETO_GERAL_STATUS } from '../escopo-geral.const'

/**
 * ── O ciclo de vida do projeto, definido por uma PESSOA ─────────────────────
 *
 * Até 20/09 havia um estado só: `active`, em **10 de 10** projetos. E o que isso afirmava era
 * falso — medido no mesmo dia: Ray coach parado desde 11/05, Rayzen-PDV desde 12/05, Banco
 * Imobiliário desde 27/05, marcelorayzen-site desde 28/06, todos `active`. Seis dos onze não
 * tiveram **uma** chamada de LLM em 30 dias.
 *
 * ── E NÃO é economia: a medição desmentiu a hipótese que abriu o trabalho ───
 *
 * A pergunta era quanto os projetos parados custam. Resposta: quase nada. O
 * `SmartCheckpointService` já exige ≥5 eventos, então parado não dispara LLM; o ciclo de
 * invariantes grava 10 relatórios em 48h por projeto, que é o batimento de 6h por desenho.
 *
 * O que justifica é verdade — o mesmo motivo do `domain` em 18/09.
 */

describe('ehStatusValido — o que uma pessoa pode declarar', () => {
  it.each(STATUS_DE_PROJETO)('aceita %s', (s) => {
    expect(ehStatusValido(s)).toBe(true)
  })

  /**
   * `geral` é ESCOPO, não ciclo de vida. Ele pertence a um projeto só, e esse já existe — deixar
   * alguém atribuí-lo a outro criaria um segundo "contexto geral" por engano.
   */
  it('recusa `geral`, que é escopo e não ciclo de vida', () => {
    expect(ehStatusValido(PROJETO_GERAL_STATUS)).toBe(false)
  })

  it.each([['pausado'], ['ACTIVE'], ['concluido'], [''], [null], [undefined], [42]])(
    'recusa %p', (v) => {
      expect(ehStatusValido(v)).toBe(false)
    })
})

describe('ehVarridoPorCiclos — o efeito que o estado existe para produzir', () => {
  it('active é varrido', () => {
    expect(ehVarridoPorCiclos('active')).toBe(true)
  })

  it.each([['paused'], ['done']])('%s NÃO é varrido', (s) => {
    expect(ehVarridoPorCiclos(s)).toBe(false)
  })

  /** O Geral ficou fora da varredura em 18/09 para não ganhar checkpoint sobre conversa solta. */
  it('o Geral continua fora', () => {
    expect(ehVarridoPorCiclos(PROJETO_GERAL_STATUS)).toBe(false)
  })

  it('ausência de status não vira varredura', () => {
    expect(ehVarridoPorCiclos(null)).toBe(false)
    expect(ehVarridoPorCiclos(undefined)).toBe(false)
  })

  /**
   * ── Lista, e não `status !== 'paused'` ────────────────────────────────────
   *
   * A negação deixa passar por OMISSÃO: um status novo gravado no banco entraria na varredura sem
   * ninguém ter decidido isso. Com lista, o valor desconhecido fica de fora até alguém incluí-lo
   * — e ficar de fora é a falha segura.
   */
  it('status desconhecido fica FORA, não dentro', () => {
    expect(ehVarridoPorCiclos('archived')).toBe(false)
    expect(ehVarridoPorCiclos('em-pausa')).toBe(false)
  })
})

/**
 * ── Escrita validada, do mesmo jeito que o `domain` ─────────────────────────
 *
 * Aceitar valor livre repetiria o defeito que a validação do `domain` existe para evitar:
 * `"pausado"` entraria no banco, os ciclos deixariam de varrer o projeto porque não é `active`, e
 * nada acusaria — o efeito colateral certo pelo motivo errado. Mesma família do
 * `hipotese_com_tasktype_valido`.
 */
describe('o update recusa status inválido', () => {
  const svc = readFileSync(
    join(__dirname, '..', '..', 'modules', 'project', 'project.service.ts'), 'utf8')

  it('valida antes de gravar', () => {
    expect(svc).toMatch(/ehStatusValido\(data\.status\)/)
    expect(svc).toMatch(/status inválido/)
  })

  it('recusa em vez de ignorar — 400, não silêncio', () => {
    const trecho = svc.slice(svc.indexOf('data.status'), svc.indexOf('data.status') + 320)
    expect(trecho).toMatch(/BadRequestException/)
  })

  /** `status` ausente no patch não pode virar rejeição: quem edita só o nome não declara status. */
  it('só valida quando o campo vem no patch', () => {
    expect(svc).toMatch(/data\.status !== undefined && !ehStatusValido/)
  })
})

/**
 * O ciclo consulta a REGRA, não repete a string. Hoje o comportamento é idêntico a
 * `status: 'active'` — o que muda é onde a decisão mora quando um status novo aparecer.
 */
describe('o auto-checkpoint varre pela regra, não por string solta', () => {
  const ciclo = readFileSync(
    join(__dirname, '..', '..', 'modules', 'synthesis', 'smart-checkpoint.service.ts'), 'utf8')

  it('usa STATUS_QUE_OS_CICLOS_VARREM', () => {
    expect(ciclo).toMatch(/STATUS_QUE_OS_CICLOS_VARREM/)
    expect(ciclo).not.toMatch(/where:\s*\{\s*status:\s*'active'\s*\}/)
  })

  it('e a lista tem só `active` — pausado e concluído ficam de fora', () => {
    expect([...STATUS_QUE_OS_CICLOS_VARREM]).toEqual(['active'])
  })
})
