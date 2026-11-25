import { execFileSync } from 'child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { abrirEntrega } from '../abrir-entrega'

jest.setTimeout(60_000)

const ID = ['-c', 'user.email=t@rayzen.local', '-c', 'user.name=t', '-c', 'commit.gpgsign=false']
const git = (cwd: string, args: string[]) =>
  execFileSync('git', [...ID, ...args], { cwd, stdio: 'pipe' }).toString().trim()

const BRANCH = 'rayzen/sessao-cmsessao'

/** remoto bare + "checkout do projeto" + um segundo clone que publicou a entrega. */
function cenario() {
  const raiz = mkdtempSync(join(tmpdir(), 'rayzen-abrir-'))
  const remoto = join(raiz, 'remoto.git')
  const checkout = join(raiz, 'projeto')
  const outro = join(raiz, 'outro')
  execFileSync('git', ['init', '--bare', '-b', 'main', remoto], { stdio: 'pipe' })
  execFileSync('git', ['clone', remoto, checkout], { stdio: 'pipe' })
  writeFileSync(join(checkout, 'a.txt'), 'base\n')
  git(checkout, ['add', '.'])
  git(checkout, ['commit', '-m', 'base'])
  git(checkout, ['push', 'origin', 'main'])
  execFileSync('git', ['clone', remoto, outro], { stdio: 'pipe' })
  git(outro, ['checkout', '-b', BRANCH])
  writeFileSync(join(outro, 'entrega.txt'), 'trabalho da sessão\n')
  git(outro, ['add', '.'])
  git(outro, ['commit', '-m', 'entrega'])
  git(outro, ['push', 'origin', `refs/heads/${BRANCH}:refs/heads/${BRANCH}`])
  return { raiz, checkout }
}

describe('abrirEntrega — worktree persistente ao lado, nunca checkout na cópia de trabalho', () => {
  let c: ReturnType<typeof cenario>
  let abrirEditor: jest.Mock
  const deps = () => ({
    resolverCheckout: async () => c.checkout,
    abrirEditor,
    dentroDaRaizSegura: () => true,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  })

  beforeEach(() => { c = cenario(); abrirEditor = jest.fn().mockResolvedValue({}) })
  afterEach(() => {
    try { git(c.checkout, ['worktree', 'prune']) } catch { /* fixture */ }
    rmSync(c.raiz, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  })

  it('busca a entrega no remoto, cria o worktree na pasta irmã e abre o editor ali', async () => {
    const headAntes = git(c.checkout, ['rev-parse', '--abbrev-ref', 'HEAD'])
    writeFileSync(join(c.checkout, 'wip.txt'), 'trabalho em andamento\n')

    const r = await abrirEntrega({ projectId: 'p1', branch: BRANCH }, deps())

    expect(r).toMatchObject({ branch: BRANCH, reutilizado: false })
    expect(r.path).toBe(join(c.raiz, 'projeto.entregas', 'sessao-cmsessao'))
    // `core.autocrlf` do Git no Windows converte no checkout — o conteúdo é o que importa.
    expect(readFileSync(join(r.path, 'entrega.txt'), 'utf8').replace(/\r\n/g, '\n')).toBe('trabalho da sessão\n')
    expect(abrirEditor).toHaveBeenCalledWith(r.path)
    // a cópia de trabalho ficou exatamente como estava
    expect(git(c.checkout, ['rev-parse', '--abbrev-ref', 'HEAD'])).toBe(headAntes)
    expect(readFileSync(join(c.checkout, 'wip.txt'), 'utf8')).toBe('trabalho em andamento\n')
    expect(existsSync(join(c.checkout, 'entrega.txt'))).toBe(false)
  })

  it('segunda abertura reaproveita o mesmo worktree', async () => {
    await abrirEntrega({ projectId: 'p1', branch: BRANCH }, deps())
    const r = await abrirEntrega({ projectId: 'p1', branch: BRANCH }, deps())
    expect(r.reutilizado).toBe(true)
    expect(abrirEditor).toHaveBeenCalledTimes(2)
  })

  it('pasta existente que não é a entrega: recusa sem tocar nela', async () => {
    const dir = join(c.raiz, 'projeto.entregas', 'sessao-cmsessao')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'meu.txt'), 'outra coisa\n')
    await expect(abrirEntrega({ projectId: 'p1', branch: BRANCH }, deps())).rejects.toThrow(/não é o worktree/)
    expect(readFileSync(join(dir, 'meu.txt'), 'utf8')).toBe('outra coisa\n')
    expect(abrirEditor).not.toHaveBeenCalled()
  })

  it.each(['main', 'feature/x', 'rayzen/../main', 'rayzen/--upload-pack=x'])('recusa branch "%s"', async (branch) => {
    await expect(abrirEntrega({ projectId: 'p1', branch }, deps())).rejects.toThrow(/rayzen\/<slug>/)
  })

  it('projeto sem checkout nesta máquina recusa', async () => {
    await expect(abrirEntrega({ projectId: 'p1', branch: BRANCH }, { ...deps(), resolverCheckout: async () => null }))
      .rejects.toThrow(/não tem checkout/)
  })

  it('com a guarda real, pasta fora das raízes seguras é recusada', async () => {
    const { dentroDaRaizSegura: _ignorada, ...semGuarda } = deps()
    await expect(abrirEntrega({ projectId: 'p1', branch: BRANCH }, semGuarda)).rejects.toThrow(/fora das raízes seguras/)
  })
})
