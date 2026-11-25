import { readFileSync } from 'fs'
import { join } from 'path'
import { alvoDaExecucao, recursoDaExecucao } from '../alvo-de-execucao.const'

const SENTINELA_INICIO = '// ─── INICIO DA REGRA COMPARTILHADA'
const SENTINELA_FIM = '// ─── FIM DA REGRA COMPARTILHADA ───'

function blocoCompartilhado(caminho: string): string {
  const fonte = readFileSync(caminho, 'utf8')
  const i = fonte.indexOf(SENTINELA_INICIO)
  const f = fonte.indexOf(SENTINELA_FIM)
  if (i < 0 || f < 0) throw new Error(`sentinelas ausentes em ${caminho}`)
  return fonte.slice(i, f + SENTINELA_FIM.length).replace(/\r\n/g, '\n').trim()
}

/**
 * ── Anti-drift, e o que a divergência causaria ──────────────────────────────
 *
 * `hashDoAlvo()` cobre ação, ator, recurso E argumentos. Quem EMITE a aprovação (o handoff, na
 * API) e quem a CONSOME (o gate do despacho, aqui) precisam descrever o alvo do mesmo jeito —
 * senão os hashes nunca casam e a autorização de um envelope é recusada justamente nos efeitos
 * de risco alto, que são os que mais precisam dela.
 *
 * `apps/api` e `apps/agent` são apps separados e `packages/types` não é compilado, então a
 * regra é copiada. Este teste lê o arquivo da API como TEXTO — mesma técnica de
 * `memory-ranking` e `risco-por-acao`.
 */
describe('alvo-de-execucao — a cópia não pode divergir da API', () => {
  it('o bloco compartilhado é idêntico nos dois apps', () => {
    const daApi = blocoCompartilhado(
      join(__dirname, '..', '..', '..', '..', 'api', 'src', 'modules', 'execution', 'alvo-de-execucao.const.ts'),
    )
    const doAgent = blocoCompartilhado(join(__dirname, '..', 'alvo-de-execucao.const.ts'))

    expect(doAgent).toBe(daApi)
  })
})

describe('alvoDaExecucao', () => {
  it('leva o payload inteiro como argumento — é o que prende a aprovação ao pedido', () => {
    const payload = { name: 'Projeto X', template: 'rayzen', handoffId: 'h1' }
    expect(alvoDaExecucao('jarvis:create_project_folder', 'desktop', payload)).toEqual({
      actionKey: 'jarvis:create_project_folder',
      actor: 'desktop',
      resource: null,
      args: payload,
    })
  })

  /** `path` é o alvo quando existe; `root` é o alvo quando a ação cria em vez de entrar. */
  it.each([
    [{ path: 'C:/x/repo' }, 'C:/x/repo'],
    [{ root: 'C:/Users/dev/Projects' }, 'C:/Users/dev/Projects'],
    [{ path: 'C:/x/repo', root: 'C:/outro' }, 'C:/x/repo'],
    [{}, null],
    [{ path: 42 }, null],
  ])('recurso de %p é %p', (payload, esperado) => {
    expect(recursoDaExecucao(payload as Record<string, unknown>)).toBe(esperado)
  })

  /**
   * O caso concreto que motivou a regra: o handoff emite e o agent consome. Se os dois não
   * produzirem o mesmo alvo, a aprovação existe e não serve.
   */
  it('emissor e consumidor produzem o mesmo alvo para a mesma carga', () => {
    const carga = { name: 'Projeto X', template: 'rayzen', root: 'C:/Users/dev/Projects', handoffId: 'h1' }

    const emitido = alvoDaExecucao('jarvis:supervised_session', 'desktop', carga)
    const consumido = alvoDaExecucao('jarvis:supervised_session', 'desktop', carga)

    expect(consumido).toEqual(emitido)
  })
})
