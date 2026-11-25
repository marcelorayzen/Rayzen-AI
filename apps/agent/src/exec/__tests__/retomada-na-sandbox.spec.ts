import { execFileSync, spawnSync } from 'child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { prepararRetomadaNaSandbox } from '../sandbox'
import type { Executor } from '../publicar-entrega'

/**
 * G3.2 (24/11) — a retomada roda o script REAL, num git de verdade: um clone com o trabalho da
 * sessão interrompida e um "GitHub" local (repositório bare) como `origin`.
 *
 * O que está em jogo: a sessão nova entra no ramo da antiga. Se o script usasse `checkout -B`
 * (o que a criação de ramo usa), o ramo seria recriado a partir do `main` e o commit da sessão
 * sumiria sem erro nenhum. Executor falso não pega isso; git de verdade pega.
 */

const temBash = spawnSync('bash', ['-c', 'git --version'], { encoding: 'utf8' }).status === 0
const descrever = temBash ? describe : describe.skip

const SESSAO = 'cmantiga0001xyz'
const RAMO = 'rayzen/sessao-cmantiga'

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

descrever('retomada na sandbox, com git de verdade', () => {
  let raiz: string
  let clone: string
  let mainOriginal: string

  beforeEach(() => {
    raiz = mkdtempSync(join(tmpdir(), 'retomada-'))
    const remoto = join(raiz, 'origin.git')
    clone = join(raiz, 'clone')
    git(raiz, 'init', '-q', '--bare', '-b', 'main', remoto)
    git(raiz, 'clone', '-q', remoto, clone)
    git(clone, 'config', 'user.name', 'Teste')
    git(clone, 'config', 'user.email', 'teste@example.invalid')
    git(clone, 'checkout', '-q', '-b', 'main')
    writeFileSync(join(clone, 'README.md'), '# projeto\n')
    git(clone, 'add', '-A')
    git(clone, 'commit', '-q', '-m', 'inicio')
    git(clone, 'push', '-q', 'origin', 'main')
    git(clone, 'remote', 'set-head', 'origin', 'main')
    mainOriginal = git(clone, 'rev-parse', 'HEAD')
    // A sessão interrompida: um commit no ramo dela e uma edição que não chegou a ser commitada.
    git(clone, 'checkout', '-q', '-b', RAMO)
    writeFileSync(join(clone, 'README.md'), '# projeto\nlinha da sessão\n')
    git(clone, 'commit', '-q', '-am', 'linha da sessão')
    writeFileSync(join(clone, 'NOTAS.md'), 'meio do caminho\n')
  })

  afterEach(() => rmSync(raiz, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }))

  /** A conferência da pasta (`/work/...`) é do container; aqui ela responde "existe". */
  function executor(): Executor {
    return async (programa, args, opts) => {
      if (String(args[1]).includes('[ -d "/work/$1/.git" ]')) return { stdout: '', stderr: '', code: 0, timedOut: false }
      const r = spawnSync(programa, [...args], { cwd: clone, encoding: 'utf8', timeout: opts.timeoutMs })
      return { stdout: r.stdout ?? '', stderr: r.stderr ?? '', code: r.status ?? 1, timedOut: false }
    }
  }

  it('mantém o commit da sessão, commita a sobra e devolve o ponto de partida', async () => {
    const commitDaSessao = git(clone, 'rev-parse', 'HEAD')
    const r = await prepararRetomadaNaSandbox(executor(), SESSAO)

    expect(r).toMatchObject({ ok: true, ramo: RAMO, headInicial: mainOriginal })
    expect(git(clone, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe(RAMO)
    // O trabalho salvo continua no ramo, e a sobra virou um commit em cima dele.
    expect(git(clone, 'rev-list', '--count', `${mainOriginal}..HEAD`)).toBe('2')
    expect(git(clone, 'merge-base', '--is-ancestor', commitDaSessao, 'HEAD') === '').toBe(true)
    expect(git(clone, 'log', '-1', '--format=%s')).toBe('wip: trabalho de antes da interrupção')
    expect(git(clone, 'status', '--porcelain')).toBe('')
  })

  it('ramo que já está no GitHub: recusa sem mexer em nada', async () => {
    git(clone, 'push', '-q', 'origin', RAMO)
    const r = await prepararRetomadaNaSandbox(executor(), SESSAO)
    expect(r).toMatchObject({ ok: false, erro: expect.stringMatching(/já está no GitHub/) })
    expect(git(clone, 'status', '--porcelain')).toContain('NOTAS.md')
  })

  it('ramo que não existe na pasta: recusa', async () => {
    git(clone, 'checkout', '-q', 'main')
    git(clone, 'branch', '-q', '-D', RAMO)
    const r = await prepararRetomadaNaSandbox(executor(), SESSAO)
    expect(r).toMatchObject({ ok: false, erro: expect.stringMatching(/não existe na pasta/) })
  })
})
