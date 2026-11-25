import { readFileSync } from 'fs'
import { join } from 'path'
import { refDeBaseValida } from '../handoff.const'

/**
 * G6.6 (21/11) — a regra do ramo de base mora em dois lugares: no envelope (api) e na sandbox
 * (agent). Se divergirem, o envelope grava um ramo que o agent recusa depois da aprovação. O
 * agent não é importável daqui (outra app, outro build), então o corpo da função é comparado
 * como texto, e o comportamento é conferido nos mesmos casos.
 */
const SANDBOX = join(__dirname, '..', '..', '..', '..', '..', 'agent', 'src', 'exec', 'sandbox.ts')
const CONST = join(__dirname, '..', 'handoff.const.ts')

function corpo(fonte: string): string {
  const m = fonte.match(/export function refDeBaseValida\(ref: unknown\): ref is string \{([\s\S]*?)\n\}/)
  if (!m) throw new Error('refDeBaseValida não encontrada')
  return m[1].replace(/\s+/g, ' ').trim()
}

describe('refDeBaseValida — api e agent', () => {
  it('o corpo da função é o mesmo nas duas apps', () => {
    expect(corpo(readFileSync(CONST, 'utf8'))).toBe(corpo(readFileSync(SANDBOX, 'utf8')))
  })

  it.each([
    ['rayzen/aceite-g6-ci-falha', true],
    ['feature/pr_7', true],
    ['main', true],
    ['--upload-pack=x', false],
    ['a/../b', false],
    ['/abs', false],
    ['fim/', false],
    ['a//b', false],
    ['ramo.lock', false],
    ['com espaço', false],
    ['', false],
  ])('%s → %s', (ref, esperado) => {
    expect(refDeBaseValida(ref)).toBe(esperado)
  })
})
