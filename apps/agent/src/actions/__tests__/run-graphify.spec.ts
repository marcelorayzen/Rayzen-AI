/**
 * 25/11/2026: o grafo de código parou em 22/06 sem ninguém notar.
 *
 * Duas causas somadas. (1) O graphify 0.8 mudou a interface: `graphify . --update --backend
 * anthropic` deixou de existir; a atualização sem LLM é `graphify update .`. (2) Depois de rodar,
 * a ação só conferia se o GRAPH_REPORT.md EXISTIA — o de junho continuava no disco, então cada
 * falha reindexava no Rayzen o relatório velho como se fosse novo.
 */
const executarPrograma = jest.fn()
jest.mock('../../exec/executar-programa', () => ({
  executarPrograma: (...args: unknown[]) => executarPrograma(...args),
  ambientePadrao: () => ({ PATH: 'x' }),
}))
jest.mock('../../utils/path-guard', () => ({ isUnderSafeRoot: () => true }))
jest.mock('node:fs', () => ({
  existsSync: () => true,
  readFileSync: () => '# relatório antigo de junho',
}))
const requisicoes: string[] = []
const fakeRequest = (opts: { path: string }, cb: (res: unknown) => void) => {
  requisicoes.push(opts.path)
  const res = { on: (ev: string, fn: (d?: string) => void) => { if (ev === 'end') fn(); else if (ev === 'data') fn('{}') } }
  return { on: () => null, setTimeout: () => null, write: () => null, end: () => cb(res) }
}
jest.mock('node:http', () => ({ request: fakeRequest }))
jest.mock('node:https', () => ({ request: fakeRequest }))

import { runGraphify_action } from '../run-graphify'

describe('runGraphify_action', () => {
  beforeEach(() => {
    executarPrograma.mockReset()
    requisicoes.length = 0
    delete process.env.AGENT_ROLE
  })

  it('chama a atualização sem LLM do graphify 0.8: `graphify update .`', async () => {
    executarPrograma.mockResolvedValue({ code: 0, stdout: 'ok', stderr: '' })
    await runGraphify_action({ projectPath: '/repo' })
    const [, programa, argv] = executarPrograma.mock.calls[0]
    expect(programa).toBe('graphify')
    expect(argv).toEqual(['update', '.'])
  })

  it('não passa chave de API ao processo-filho: a atualização não usa LLM', async () => {
    executarPrograma.mockResolvedValue({ code: 0, stdout: 'ok', stderr: '' })
    await runGraphify_action({ projectPath: '/repo' })
    const [, , , opcoes] = executarPrograma.mock.calls[0]
    expect(opcoes.env).not.toHaveProperty('ANTHROPIC_API_KEY')
  })

  it('se o graphify falha, devolve erro e NÃO reindexa o relatório que já estava no disco', async () => {
    executarPrograma.mockResolvedValue({ code: 2, stdout: '', stderr: 'unknown command' })
    const r = await runGraphify_action({ projectPath: '/repo' }) as { ok: boolean; error?: string }
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/graphify/)
    expect(requisicoes).toHaveLength(0)
  })

  it('se o graphify passa, indexa o relatório', async () => {
    executarPrograma.mockResolvedValue({ code: 0, stdout: 'ok', stderr: '' })
    const r = await runGraphify_action({ projectPath: '/repo' }) as { ok: boolean }
    expect(r.ok).toBe(true)
    expect(requisicoes).toEqual(['/memory/index'])
  })
})
