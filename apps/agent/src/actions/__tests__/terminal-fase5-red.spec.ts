import { execSync } from 'child_process'
import { runCommand } from '../terminal'
import * as pathGuard from '../../utils/path-guard'

/**
 * Fase 5 do plano de execução tipada — `run_command` genérico é RED, acima de `high`, e a
 * classificação é sobre a FORMA (texto livre), não sobre qual `ALLOW_RULES` casou.
 *
 * Até 11/09 só `rule.risk === 'high'` exigia aprovação humana — um `git status` (risco
 * `none`) executava direto, sem gate nenhum. O ponto do plano não é "este comando é
 * perigoso", é "esta ENTRADA é a classe perigosa": todo comando que chega aqui, veio de
 * onde vier, precisa de aprovação criada no servidor, mesmo os que a regra classifica como
 * inofensivos. `git status`/`docker ps` por aqui já são redundantes com as ações tipadas
 * (Fase 1) e as capabilities (Fase 2) — quem precisa de leitura simples tem caminho tipado.
 *
 * Não mocka `../../exec/approval-client` inteiro — usa `fetch` real (mockado) mais
 * `AGENT_TOKEN`, a mesma técnica de `aprovacao-no-agent.spec.ts`, para provar o CAMINHO
 * inteiro (`runCommand` → `consumirAprovacao` → `fetch`), não uma função isolada.
 */
jest.mock('child_process', () => ({ execSync: jest.fn(() => 'saida simulada') }))
jest.mock('../../utils/path-guard', () => ({
  isUnderSafeRoot: jest.fn().mockReturnValue(true),
  SAFE_ROOTS: [process.env.USERPROFILE ?? '/home/user'],
}))

describe('run_command genérico — Fase 5, risco red independente da sub-regra', () => {
  const origFetch = global.fetch
  afterEach(() => {
    global.fetch = origFetch
    delete process.env.AGENT_TOKEN
    ;(execSync as jest.Mock).mockClear()
  })

  it.each([
    ['none',   'git status'],
    ['low',    'git stash list'],
    ['medium', 'pnpm test'],
    ['high',   'pnpm install'],
  ])('sub-risco %s: sem aprovação, recusa com risco red — nunca executa por ser "seguro"', async (_subRisco, cmd) => {
    process.env.AGENT_TOKEN = 't'
    global.fetch = jest.fn().mockResolvedValue({
      ok: true, json: () => Promise.resolve({ ok: false }),
    }) as unknown as typeof fetch

    const r = await runCommand({ command: cmd })

    expect(r.skipped).toBe(true)
    expect(r.risk).toBe('red')
    expect(execSync).not.toHaveBeenCalled()
  })

  /**
   * A inversão exata do defeito: ANTES desta fase, este mesmo comando (`git status`, risco
   * `none`) executava sem pedir nada a ninguém. Vermelho de propósito — revertendo o gate
   * para `rule.risk === 'high'` (a condição antiga) faz este teste falhar, provando que ele
   * pega a regressão e não passa verde por estrutura do mock.
   */
  it('git status sem AGENT_TOKEN (sem como pedir aprovação) recusa — não é mais "risco none, livre"', async () => {
    const r = await runCommand({ command: 'git status' })
    expect(r.skipped).toBe(true)
    expect(r.reason).toBe('high-risk requires human approval')
    expect(execSync).not.toHaveBeenCalled()
  })

  it('com aprovação concedida no servidor, git status (risco none) executa', async () => {
    process.env.AGENT_TOKEN = 't'
    global.fetch = jest.fn().mockResolvedValue({
      ok: true, json: () => Promise.resolve({ ok: true }),
    }) as unknown as typeof fetch

    const r = await runCommand({ command: 'git status' })
    expect(r.skipped).toBe(false)
    expect(execSync).toHaveBeenCalledWith('git status', expect.anything())
  })

  /**
   * Fase 4 fechando uma lacuna que só existia neste caminho legado: `execSync` sem chave
   * `env` nas opções herda `process.env` inteiro por omissão — o mesmo efeito de
   * `{ ...process.env }`, só sem o spread visível. Prova que `ambientePadrao()` agora
   * filtra aqui também, com um segredo real no `process.env` do processo de teste.
   */
  it('execSync recebe ambientePadrao() — AGENT_TOKEN não viaja no env do comando aprovado', async () => {
    process.env.AGENT_TOKEN = 'segredo-nao-pode-vazar-para-o-execsync'
    global.fetch = jest.fn().mockResolvedValue({
      ok: true, json: () => Promise.resolve({ ok: true }),
    }) as unknown as typeof fetch

    await runCommand({ command: 'git status' })

    const opcoes = (execSync as jest.Mock).mock.calls[0][1] as { env?: NodeJS.ProcessEnv }
    expect(opcoes.env).toBeDefined()
    expect(opcoes.env?.AGENT_TOKEN).toBeUndefined()
  })

  /**
   * Caminho inválido é checagem LOCAL, sem custo de rede — não faz sentido pedir (e
   * consumir) uma aprovação para um pedido cujo `path` já está fora do sandbox. Confirma a
   * ORDEM: `fetch` (a chamada de aprovação) nunca é alcançado quando o path falha antes.
   */
  it('path fora do sandbox recusa ANTES de tentar pedir aprovação — fetch nunca é chamado', async () => {
    process.env.AGENT_TOKEN = 't'
    const mockIsUnder = pathGuard.isUnderSafeRoot as jest.Mock
    mockIsUnder.mockReturnValueOnce(false)
    const fetchMock = jest.fn()
    global.fetch = fetchMock as unknown as typeof fetch

    await expect(runCommand({ command: 'git status', path: '/etc' })).rejects.toThrow('Caminho não permitido')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
