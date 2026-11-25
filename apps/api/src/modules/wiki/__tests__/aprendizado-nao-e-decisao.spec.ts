import { readFileSync } from 'fs'
import { join } from 'path'

/**
 * 13/11 — aprendizado capturado não é decisão.
 *
 * `recentDecisions` vem só de eventos `type: 'decision'` (19/09). O evento que o
 * `captureLearning` emitia era `decision`, então cada captura virava "decisão do projeto" —
 * medido no Rayzen AI: as duas mais recentes eram o mesmo "Flaky: …" do QA, duas vezes.
 *
 * Lido como texto: `WikiService` tem nove dependências e nenhum spec próprio, e a pergunta aqui
 * é uma só — qual `type` o evento do aprendizado carrega.
 */
describe('captureLearning — o evento do aprendizado não entra como decisão', () => {
  const fonte = readFileSync(join(__dirname, '..', 'wiki.service.ts'), 'utf8')
  // Do ÚLTIMO `eventService.create({` antes da linha do aprendizado até ela: um regex a partir do
  // primeiro `create` do arquivo atravessaria outros eventos e mediria o bloco errado.
  const fim = fonte.indexOf('Aprendizado capturado')
  const inicio = fonte.lastIndexOf('this.eventService.create({', fim)
  const bloco = fim > 0 && inicio > 0 ? fonte.slice(inicio, fim) : ''

  it('o bloco existe (senão o teste passaria por não achar nada)', () => {
    expect(bloco).not.toBe('')
  })

  it('é nota de referência, nunca decision', () => {
    expect(bloco).toMatch(/type: 'note'/)
    expect(bloco).toMatch(/intent: 'reference'/)
    expect(bloco).not.toMatch(/'decision'/)
  })
})
