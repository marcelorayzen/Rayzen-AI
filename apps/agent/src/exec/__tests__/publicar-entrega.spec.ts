import { execFileSync } from 'child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  publicarEntrega, branchPublicavel, ambienteDePublicacao, type Executor,
} from '../publicar-entrega'
import { executarPrograma } from '../executar-programa'
import type { ResultadoDeExecucao } from '../executar-programa'

/**
 * Contra repositórios git REAIS (remoto `--bare` + clone) — só o `gh` é dublê. Um teste que
 * simulasse o git provaria a sequência de chamadas, não que o branch chegou ao remoto.
 */

// git real no Windows: cenário + push passam fácil dos 5s padrão.
jest.setTimeout(60_000)

const IDENTIDADE = ['-c', 'user.email=teste@rayzen.local', '-c', 'user.name=teste', '-c', 'commit.gpgsign=false']

function git(cwd: string, args: string[]): string {
  return execFileSync('git', [...IDENTIDADE, ...args], { cwd, stdio: 'pipe' }).toString().trim()
}

interface Cenario { raiz: string; remoto: string; clone: string }

function cenario(): Cenario {
  const raiz = mkdtempSync(join(tmpdir(), 'rayzen-publicar-'))
  const remoto = join(raiz, 'remoto.git')
  const clone = join(raiz, 'clone')
  execFileSync('git', ['init', '--bare', '-b', 'main', remoto], { stdio: 'pipe' })
  execFileSync('git', ['clone', remoto, clone], { stdio: 'pipe' })
  writeFileSync(join(clone, 'README.md'), 'base\n')
  git(clone, ['add', '.'])
  git(clone, ['commit', '-m', 'base'])
  git(clone, ['push', 'origin', 'main'])
  git(clone, ['remote', 'set-head', 'origin', 'main'])
  return { raiz, remoto, clone }
}

function commitNoBranch(c: Cenario, branch: string, arquivo = 'novo.txt') {
  git(c.clone, ['checkout', '-b', branch])
  writeFileSync(join(c.clone, arquivo), 'trabalho da sessão\n')
  git(c.clone, ['add', '.'])
  git(c.clone, ['commit', '-m', 'trabalho'])
  git(c.clone, ['checkout', 'main'])
}

const ok = (stdout: string): ResultadoDeExecucao => ({ stdout, stderr: '', code: 0, timedOut: false })
const falha = (stderr: string): ResultadoDeExecucao => ({ stdout: '', stderr, code: 1, timedOut: false })

/** git de verdade; `gh` respondido pelo dublê, com cada chamada registrada. */
function executorCom(gh: (args: readonly string[]) => ResultadoDeExecucao) {
  const chamadasGh: string[][] = []
  const executar: Executor = async (programa, args, opts) => {
    if (programa === 'gh') { chamadasGh.push([...args]); return gh(args) }
    return executarPrograma('executavel', programa, args, opts)
  }
  return { executar, chamadasGh }
}

const PR = { titulo: 'Entrega da sessão', corpo: 'Resumo' }
const ENV = { ...process.env, GIT_TERMINAL_PROMPT: '0' }

describe('publicarEntrega — branch rayzen/* + PR em rascunho', () => {
  let c: Cenario
  beforeEach(() => { c = cenario() })
  afterEach(() => rmSync(c.raiz, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }))

  it('publica o branch no remoto e abre PR em rascunho contra a base', async () => {
    commitNoBranch(c, 'rayzen/sessao-abc12345')
    const { executar, chamadasGh } = executorCom((args) =>
      args[1] === 'view' ? falha('no pull requests found') : ok('https://github.com/x/y/pull/7\n'))

    const r = await publicarEntrega(c.clone, 'rayzen/sessao-abc12345', PR, { executar, env: ENV })

    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.entrega).toMatchObject({
      branch: 'rayzen/sessao-abc12345', base: 'origin/main', commitsAFrente: 1,
      prUrl: 'https://github.com/x/y/pull/7',
    })
    expect(r.entrega.diffstat).toMatch(/1 file changed/)
    // chegou ao remoto, no mesmo commit
    expect(git(c.remoto, ['rev-parse', 'refs/heads/rayzen/sessao-abc12345'])).toBe(r.entrega.commit)
    const criar = chamadasGh.find((a) => a[1] === 'create')!
    expect(criar).toEqual(expect.arrayContaining(['--draft', '--head', 'rayzen/sessao-abc12345', '--base', 'main']))
  })

  // G6, fatia 4: a correção de um PR parte do ramo dele e volta para ele, não para `main`.
  it('com baseRef, conta os commits contra o ramo pedido e abre o PR contra ele', async () => {
    git(c.clone, ['checkout', '-b', 'feature/pr-7'])
    writeFileSync(join(c.clone, 'pr.txt'), 'trabalho do PR\n')
    git(c.clone, ['add', '.'])
    git(c.clone, ['commit', '-m', 'pr'])
    git(c.clone, ['push', 'origin', 'feature/pr-7'])
    git(c.clone, ['checkout', '-b', 'rayzen/sessao-fix12345'])
    writeFileSync(join(c.clone, 'fix.txt'), 'correção\n')
    git(c.clone, ['add', '.'])
    git(c.clone, ['commit', '-m', 'correção'])
    git(c.clone, ['checkout', 'main'])
    const { executar, chamadasGh } = executorCom((args) =>
      args[1] === 'view' ? falha('no pull requests found') : ok('https://github.com/x/y/pull/8\n'))

    const r = await publicarEntrega(c.clone, 'rayzen/sessao-fix12345', PR, { executar, env: ENV, baseRef: 'feature/pr-7' })

    expect(r.ok).toBe(true)
    if (!r.ok) return
    // Contra `main` seriam 2 commits (o do PR e o da correção); contra o ramo do PR, só a correção.
    expect(r.entrega).toMatchObject({ base: 'origin/feature/pr-7', commitsAFrente: 1 })
    const criar = chamadasGh.find((a) => a[1] === 'create')!
    expect(criar).toEqual(expect.arrayContaining(['--base', 'feature/pr-7']))
  })

  it('baseRef que não existe no remoto recusa sem publicar — nunca cai para main', async () => {
    commitNoBranch(c, 'rayzen/sessao-sembase1')
    const { executar, chamadasGh } = executorCom(() => ok(''))

    const r = await publicarEntrega(c.clone, 'rayzen/sessao-sembase1', PR, { executar, env: ENV, baseRef: 'nao/existe' })

    expect(r).toMatchObject({ ok: false, motivo: 'sem_base' })
    expect(git(c.remoto, ['branch', '--list', 'rayzen/*'])).toBe('')
    expect(chamadasGh).toEqual([])
  })

  it('reentregar devolve o PR existente sem abrir outro', async () => {
    commitNoBranch(c, 'rayzen/sessao-abc12345')
    const { executar, chamadasGh } = executorCom(() => ok('https://github.com/x/y/pull/7\n'))

    const r = await publicarEntrega(c.clone, 'rayzen/sessao-abc12345', PR, { executar, env: ENV })
    const r2 = await publicarEntrega(c.clone, 'rayzen/sessao-abc12345', PR, { executar, env: ENV })

    expect(r.ok && r2.ok).toBe(true)
    expect(chamadasGh.some((a) => a[1] === 'create')).toBe(false)
  })

  it('PR que falha não desfaz a entrega: branch publicado, prErro declarado', async () => {
    commitNoBranch(c, 'rayzen/sessao-abc12345')
    const { executar } = executorCom(() => falha('HTTP 422: no commits between'))

    const r = await publicarEntrega(c.clone, 'rayzen/sessao-abc12345', PR, { executar, env: ENV })

    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.entrega.prUrl).toBeUndefined()
    expect(r.entrega.prErro).toMatch(/422/)
    expect(git(c.remoto, ['branch', '--list', 'rayzen/sessao-abc12345'])).toContain('rayzen/sessao-abc12345')
  })

  it('branch sem commit à frente da base não é entrega — nada é publicado', async () => {
    git(c.clone, ['branch', 'rayzen/sessao-vazio'])
    const { executar, chamadasGh } = executorCom(() => ok(''))

    const r = await publicarEntrega(c.clone, 'rayzen/sessao-vazio', PR, { executar, env: ENV })

    expect(r).toMatchObject({ ok: false, motivo: 'sem_commits' })
    expect(git(c.remoto, ['branch', '--list', 'rayzen/*'])).toBe('')
    expect(chamadasGh).toHaveLength(0)
  })

  it('repositório sem remoto recusa sem tentar', async () => {
    git(c.clone, ['remote', 'remove', 'origin'])
    commitNoBranch(c, 'rayzen/sessao-abc12345')
    const { executar } = executorCom(() => ok(''))

    await expect(publicarEntrega(c.clone, 'rayzen/sessao-abc12345', PR, { executar, env: ENV }))
      .resolves.toMatchObject({ ok: false, motivo: 'sem_remoto' })
  })

  it.each([
    'main', 'master', 'feature/x', 'rayzen/', 'rayzen/../main', 'rayzen/--upload-pack=x',
    'rayzen/Sessao', 'rayzen/a b', 'refs/heads/main', 'rayzen/x:main',
  ])('recusa "%s" antes de rodar qualquer comando', async (branch) => {
    const executar = jest.fn<ReturnType<Executor>, Parameters<Executor>>()
    const r = await publicarEntrega(c.clone, branch, PR, { executar, env: ENV })
    expect(r).toMatchObject({ ok: false, motivo: 'branch_recusado' })
    expect(executar).not.toHaveBeenCalled()
    expect(branchPublicavel(branch)).toBe(false)
  })

  it('main nunca é alterado no remoto, mesmo com commit local novo', async () => {
    const mainAntes = git(c.remoto, ['rev-parse', 'refs/heads/main'])
    writeFileSync(join(c.clone, 'local.txt'), 'não publicado\n')
    git(c.clone, ['add', '.'])
    git(c.clone, ['commit', '-m', 'local em main'])
    commitNoBranch(c, 'rayzen/sessao-abc12345')
    const { executar } = executorCom(() => ok('https://github.com/x/y/pull/1\n'))

    await publicarEntrega(c.clone, 'rayzen/sessao-abc12345', PR, { executar, env: ENV })

    expect(git(c.remoto, ['rev-parse', 'refs/heads/main'])).toBe(mainAntes)
  })
})

describe('ambienteDePublicacao — APPDATA nomeado, segredo de fora', () => {
  it('leva APPDATA (config do gh) e desliga prompt interativo', () => {
    const env = ambienteDePublicacao({ PATH: '/bin', APPDATA: 'C:\\A', AGENT_TOKEN: 'segredo', LITELLM_MASTER_KEY: 'x' })
    expect(env).toMatchObject({ PATH: '/bin', APPDATA: 'C:\\A', GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' })
    expect(env.AGENT_TOKEN).toBeUndefined()
    expect(env.LITELLM_MASTER_KEY).toBeUndefined()
  })
})
