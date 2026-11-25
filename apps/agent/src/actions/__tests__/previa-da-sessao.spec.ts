import { execFileSync } from 'child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { previaDaSessao, branchDaSessao } from '../previa-da-sessao'
import { supervisedSession } from '../supervised-session'
import { executarPrograma, type ResultadoDeExecucao } from '../../exec/executar-programa'
import type { Executor } from '../../exec/publicar-entrega'

jest.setTimeout(60_000)

const ID = ['-c', 'user.email=t@rayzen.local', '-c', 'user.name=t', '-c', 'commit.gpgsign=false']
const git = (cwd: string, args: string[]) =>
  execFileSync('git', [...ID, ...args], { cwd, stdio: 'pipe' }).toString().trim()

const SESSAO = 'cabc12345def'
const BRANCH = branchDaSessao(SESSAO)

function cenario() {
  const raiz = mkdtempSync(join(tmpdir(), 'rayzen-previa-'))
  const remoto = join(raiz, 'remoto.git')
  const clone = join(raiz, 'clone')
  execFileSync('git', ['init', '--bare', '-b', 'main', remoto], { stdio: 'pipe' })
  execFileSync('git', ['clone', remoto, clone], { stdio: 'pipe' })
  writeFileSync(join(clone, 'a.txt'), 'a\n')
  git(clone, ['add', '.'])
  git(clone, ['commit', '-m', 'base'])
  git(clone, ['push', 'origin', 'main'])
  return { raiz, remoto, clone }
}

const ok = (stdout: string): ResultadoDeExecucao => ({ stdout, stderr: '', code: 0, timedOut: false })

function executorCom(gh: (args: readonly string[]) => ResultadoDeExecucao) {
  const chamadasGh: string[][] = []
  const executar: Executor = async (programa, args, opts) => {
    if (programa === 'gh') { chamadasGh.push([...args]); return gh(args) }
    return executarPrograma('executavel', programa, args, opts)
  }
  return { executar, chamadasGh }
}

describe('previaDaSessao — o mundo antes e depois, medido de novo', () => {
  let c: ReturnType<typeof cenario>
  beforeEach(() => { c = cenario() })
  afterEach(() => rmSync(c.raiz, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }))

  it('preflight: repo com remoto, gh autenticado, branch ainda ausente — ausência MEDIDA', async () => {
    const { executar } = executorCom(() => ok('Logged in'))
    const r = await previaDaSessao({ sessionId: SESSAO, projectPath: c.clone, publicar: true }, { executar })

    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.path).toBe(c.clone)
    expect(r.previa).toMatchObject({
      tipo: 'sessao_supervisionada', branch: BRANCH, publicar: true, ghAutenticado: true,
      entrega: { commitLocal: null, commitNoRemoto: null, prUrl: null, inconclusiva: false },
    })
    expect(r.previa.git.estado).toBe('repo')
    expect(r.previa.remoto).toBe(c.remoto)
  })

  it('postflight: branch no remoto e PR medidos independentemente do relato da sessão', async () => {
    git(c.clone, ['checkout', '-b', BRANCH])
    writeFileSync(join(c.clone, 'b.txt'), 'b\n')
    git(c.clone, ['add', '.'])
    git(c.clone, ['commit', '-m', 'trabalho'])
    git(c.clone, ['push', 'origin', `refs/heads/${BRANCH}:refs/heads/${BRANCH}`])
    const sha = git(c.clone, ['rev-parse', 'HEAD'])
    const { executar } = executorCom((args) => args[1] === 'view'
      ? ok(JSON.stringify({ url: 'https://github.com/x/y/pull/3', state: 'OPEN', isDraft: true }))
      : ok('Logged in'))

    const r = await previaDaSessao({ sessionId: SESSAO, projectPath: c.clone, publicar: true }, { executar })

    expect(r.ok && r.previa.entrega).toEqual({
      commitLocal: sha, commitNoRemoto: sha, prUrl: 'https://github.com/x/y/pull/3', prEstado: 'OPEN', prRascunho: true, inconclusiva: false,
    })
  })

  it('sem publicar, o gh não é consultado nem é pré-condição', async () => {
    const { executar, chamadasGh } = executorCom(() => ok(''))
    const r = await previaDaSessao({ sessionId: SESSAO, projectPath: c.clone }, { executar })
    expect(r.ok && r.previa.ghAutenticado).toBeNull()
    expect(chamadasGh).toHaveLength(0)
  })

  it('fora de repositório: sem remoto, entrega inconclusiva — não "ausente"', async () => {
    const solto = join(c.raiz, 'solto')
    mkdirSync(solto)
    const { executar } = executorCom(() => ok(''))
    const r = await previaDaSessao({ sessionId: SESSAO, projectPath: solto, publicar: true }, { executar })
    expect(r.ok && r.previa.remoto).toBeNull()
    expect(r.ok && r.previa.entrega.inconclusiva).toBe(true)
  })

  it('dryRun da sessão devolve a prévia sem rodar modelo nem postar na API', async () => {
    const executarModelo = jest.fn()
    const postar = jest.fn()
    const r = await supervisedSession(
      { sessionId: SESSAO, prompt: 'x', projectPath: c.clone, dryRun: true },
      { executarModelo, postar },
    )
    expect(r).toMatchObject({ ok: true, path: c.clone, previa: { tipo: 'sessao_supervisionada' } })
    expect(executarModelo).not.toHaveBeenCalled()
    expect(postar).not.toHaveBeenCalled()
  })
})
