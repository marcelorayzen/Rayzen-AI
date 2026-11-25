// O caso "com aprovacao, executa" precisa PASSAR do gate — e passar do gate significa chegar ao
// execSync. Sem este mock ele rodava `pnpm install` de verdade (medido: 2587ms). Teste de
// seguranca que executa o comando que esta testando e um teste que causa o que investiga.
jest.mock('child_process', () => ({ execSync: jest.fn(() => 'saida simulada') }))

import { execSync } from 'child_process'
import { hashDoAlvo, consumirAprovacao } from '../approval-client'
import { runCommand } from '../../actions/terminal'
import { ambienteMinimo, CREDENCIAIS_NAO_REPASSADAS } from '../../actions/supervised-session'
import { readFileSync } from 'fs'
import { join } from 'path'

/**
 * Fase 5-A no lado do agent: `force: true` deixa de autorizar, e o agent PEDE aprovacao em vez
 * de conceder.
 */
describe('run_command — force não autoriza mais risco high', () => {
  const origFetch = global.fetch
  afterEach(() => { global.fetch = origFetch; delete process.env.AGENT_TOKEN })

  /** O defeito exato que a fase fecha: quem monta o payload concedia a propria aprovacao. */
  it('force: true no payload NÃO executa mais risco high', async () => {
    process.env.AGENT_TOKEN = 't'
    global.fetch = jest.fn().mockResolvedValue({
      ok: true, json: () => Promise.resolve({ ok: false, motivo: 'sem aprovação válida' }),
    }) as unknown as typeof fetch

    const r = await runCommand({ command: 'pnpm install', force: true })

    expect(r.skipped).toBe(true)
    expect(r.reason).toBe('high-risk requires human approval')
  })

  it('com aprovação consumida no servidor, executa', async () => {
    process.env.AGENT_TOKEN = 't'
    ;(execSync as jest.Mock).mockClear()
    global.fetch = jest.fn().mockResolvedValue({
      ok: true, json: () => Promise.resolve({ ok: true }),
    }) as unknown as typeof fetch

    const r = await runCommand({ command: 'pnpm install', dryRun: false, force: false })

    expect(r.skipped).toBe(false)
    expect(execSync).toHaveBeenCalledWith('pnpm install', expect.anything())
  })

  /** O gate roda ANTES do execSync — não adianta negar depois de executar. */
  it('sem aprovação, o execSync nem é alcançado', async () => {
    process.env.AGENT_TOKEN = 't'
    ;(execSync as jest.Mock).mockClear()
    global.fetch = jest.fn().mockResolvedValue({
      ok: true, json: () => Promise.resolve({ ok: false }),
    }) as unknown as typeof fetch

    await runCommand({ command: 'pnpm install', force: true })

    expect(execSync).not.toHaveBeenCalled()
  })

  /**
   * Falha de rede e NEGACAO. Gate que vale quando o servidor nao responde cai aberto justo
   * quando ninguem esta olhando — e o modo de falha classico deste tipo de checagem.
   */
  it('servidor fora do ar nega, não libera', async () => {
    process.env.AGENT_TOKEN = 't'
    global.fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED')) as unknown as typeof fetch

    const r = await runCommand({ command: 'pnpm install', force: true })
    expect(r.skipped).toBe(true)
  })

  it('corpo inesperado não vira autorização por coerção', async () => {
    process.env.AGENT_TOKEN = 't'
    global.fetch = jest.fn().mockResolvedValue({
      ok: true, json: () => Promise.resolve({ ok: 'sim' }),   // string, não boolean
    }) as unknown as typeof fetch

    await expect(consumirAprovacao({ actionKey: 'x', actor: 'desktop', args: {} }))
      .resolves.toMatchObject({ ok: false })
  })

  it('sem AGENT_TOKEN não há como pedir — e isso é negação', async () => {
    delete process.env.AGENT_TOKEN
    await expect(consumirAprovacao({ actionKey: 'x', actor: 'desktop', args: {} }))
      .resolves.toMatchObject({ ok: false })
  })
})

/**
 * O canonico e duplicado entre agent e API de proposito (o agent nao importa codigo da API).
 * Drift apareceria como "aprovacao nunca casa" — sintoma que leva a desligar a checagem —,
 * entao o vetor e travado aqui e no spec da API.
 */
describe('hash canônico — agent e API precisam concordar', () => {
  it('vetor compartilhado', () => {
    const alvo = { actionKey: 'jarvis:run_command', actor: 'desktop', resource: '/repo', args: { command: 'pnpm install' } }
    // Mesmo alvo, chaves em outra ordem: mesmo hash.
    const outraOrdem = { args: { command: 'pnpm install' }, resource: '/repo', actor: 'desktop', actionKey: 'jarvis:run_command' }
    expect(hashDoAlvo(alvo)).toBe(hashDoAlvo(outraOrdem))
    expect(hashDoAlvo(alvo)).toMatch(/^[0-9a-f]{64}$/)
  })

  it('a implementação do agent é idêntica à da API', () => {
    const limpar = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ').trim()
    const trecho = (arquivo: string) => {
      const t = readFileSync(arquivo, 'utf8')
      const i = t.indexOf('const canonico = JSON.stringify({')
      return limpar(t.slice(i, t.indexOf('}', t.indexOf('return v', i))))
    }
    const noAgent = trecho(join(__dirname, '..', 'approval-client.ts'))
    const naApi   = trecho(join(__dirname, '..', '..', '..', '..', 'api', 'src', 'modules', 'execution', 'approval.service.ts'))
    expect(noAgent).toBe(naApi)
  })
})

/**
 * A sessao supervisionada herdava `process.env` inteiro — AGENT_TOKEN, LITELLM_MASTER_KEY e
 * MCP_READONLY_TOKEN entregues a um processo que roda codigo de terceiros por definicao.
 */
describe('supervised_session — ambiente mínimo', () => {
  it.each(CREDENCIAIS_NAO_REPASSADAS)('não repassa %s', (chave) => {
    const env = ambienteMinimo({ PATH: '/bin', [chave]: 'valor-secreto' } as NodeJS.ProcessEnv)
    expect(env[chave]).toBeUndefined()
  })

  it('repassa o mínimo para o processo funcionar', () => {
    const env = ambienteMinimo({ PATH: '/bin', HOME: '/h', AGENT_TOKEN: 'x' } as NodeJS.ProcessEnv)
    expect(env.PATH).toBe('/bin')
    expect(env.HOME).toBe('/h')
  })

  /**
   * Lista de PERMISSAO, nao de negacao: variavel nova nasce FORA. Uma lista de negacao deixaria
   * toda variavel futura entrar por omissao — e assim que segredo vaza sem ninguem notar.
   */
  it('variável desconhecida não passa por omissão', () => {
    const env = ambienteMinimo({ PATH: '/bin', SEGREDO_NOVO_DE_2027: 'x' } as NodeJS.ProcessEnv)
    expect(env.SEGREDO_NOVO_DE_2027).toBeUndefined()
  })

  it('o spawn não usa mais o spread de process.env', () => {
    const codigo = readFileSync(join(__dirname, '..', '..', 'actions', 'supervised-session.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
    expect(codigo).not.toMatch(/env:\s*\{\s*\.\.\.process\.env\s*\}/)
    expect(codigo).toMatch(/env:\s*ambienteMinimo\(\)/)
  })
})

/**
 * Limpar o `env` impede o filho de LER a variavel; nao impede o mesmo segredo em ARQUIVO. O
 * processo continua rodando como o dono, e `.env`, `~/.ssh` e `hook.config.mjs` estao no disco.
 * Negar a leitura desses caminhos e o que fecha o par — nao e isolamento, e reducao de
 * superficie; isolamento de verdade e a Fase 4-B.
 */
describe('supervised_session — segredo em arquivo também é negado', () => {
  const { FERRAMENTAS_NEGADAS: negadas, CREDENCIAIS_INDISPENSAVEIS } =
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require('../../actions/supervised-session') as {
      FERRAMENTAS_NEGADAS: string[]
      CREDENCIAIS_INDISPENSAVEIS: readonly string[]
    }

  it.each([
    ['.env de qualquer projeto', 'Read(**/.env)'],
    ['variantes de .env',        'Read(**/.env.*)'],
    ['chaves privadas',          'Read(**/*.pem)'],
    ['chave ssh ed25519',        'Read(**/id_ed25519*)'],
    ['config do hook',           'Read(**/hook.config.mjs)'],
    ['diretório .ssh',           'Read(//**/.ssh/**)'],
    ['diretório .claude',        'Read(//**/.claude/**)'],
  ])('nega %s', (_n, padrao) => {
    expect(negadas).toContain(padrao)
  })

  /** Ler por outro caminho e o mesmo que ler. */
  it.each(['Bash(cat:*)', 'Bash(type:*)', 'Bash(more:*)'])('nega leitura via %s', (padrao) => {
    expect(negadas).toContain(padrao)
  })

  /**
   * A lista de indispensaveis e VAZIA e isso e uma afirmacao, nao um esquecimento: nenhuma
   * credencial precisa viajar por env hoje. Se deixar de ser vazia, alguem decidiu — e o
   * teste obriga a decidir de novo.
   */
  it('nenhuma credencial é indispensável hoje', () => {
    expect(CREDENCIAIS_INDISPENSAVEIS).toEqual([])
  })
})
