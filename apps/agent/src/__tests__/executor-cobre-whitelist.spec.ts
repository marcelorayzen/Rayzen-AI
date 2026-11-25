import { readFileSync } from 'fs'
import { join } from 'path'
import { ALLOWED_ACTIONS } from '../security/whitelist'

/**
 * Achado da varredura de 2026-09-12: `jarvis:guardian_analyze` estava na whitelist, com
 * escopo de role e registrado como skill em `apps/api-v2` — mas `executor.ts` nunca teve um
 * `case` para ele. Qualquer despacho real passava pelas duas primeiras barreiras (whitelist,
 * role) e só quebrava na terceira, com `Handler não implementado`. `whitelist.spec.ts` já
 * testava "toda ação documentada está na whitelist" — o que faltava era o inverso: "toda ação
 * na whitelist tem quem a execute". Sem este teste, uma ação whitelisted sem handler passa
 * verde para sempre, porque nenhuma suíte a invoca.
 *
 * Lê `executor.ts` como texto (não importa o módulo) para não precisar mockar as ~40 ações
 * que ele importa só para contar `case`s — mesma técnica de `escopo-leitura.spec.ts`.
 */
describe('executor.ts — toda ação da whitelist tem um case correspondente', () => {
  const fonte = readFileSync(join(__dirname, '..', 'executor.ts'), 'utf8')
  const casosNoSwitch = new Set(
    [...fonte.matchAll(/case\s+'(jarvis:[a-z_]+)'/g)].map((m) => m[1]),
  )

  it('achou pelo menos 40 casos no switch — a regex não quebrou silenciosamente', () => {
    expect(casosNoSwitch.size).toBeGreaterThan(40)
  })

  it.each([...ALLOWED_ACTIONS])('%s tem um case em executor.ts', (acao) => {
    expect(casosNoSwitch.has(acao)).toBe(true)
  })

  it('nenhum case do switch referencia uma ação fora da whitelist (a lista inversa também não diverge)', () => {
    const orfaos = [...casosNoSwitch].filter((c) => !ALLOWED_ACTIONS.has(c))
    expect(orfaos).toEqual([])
  })
})
