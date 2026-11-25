import { execFileSync } from 'child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { retratoDoGit } from '../retrato-do-git'

function git(args: string[], cwd: string) {
  execFileSync('git', args, { cwd, stdio: 'pipe' })
}

function repoComCommit(dir: string) {
  git(['init', '-q'], dir)
  git(['config', 'user.email', 'teste@rayzen.local'], dir)
  git(['config', 'user.name', 'Teste'], dir)
  writeFileSync(join(dir, 'a.txt'), 'conteudo\n')
  git(['add', '.'], dir)
  git(['commit', '-q', '-m', 'inicial'], dir)
}

/**
 * ── Contra git de verdade, não contra um mock ───────────────────────────────
 *
 * O que este retrato precisa acertar é o comportamento do git, e um dublê só repetiria a
 * suposição de quem o escreveu. É a mesma escolha de `git-fase1-emergencial.spec.ts`, que
 * roda contra repositórios reais porque a pergunta é sobre o que o git faz.
 */
/**
 * ── Aqui o fixture mora em `tmpdir()`, e não em `~/Projects` ────────────────
 *
 * Os outros specs nascem sob um safe root porque a AÇÃO sob teste recusa qualquer caminho fora
 * dele. `retratoDoGit` não faz essa checagem — ele só roda git num diretório —, então a razão
 * não se aplica, e `~/Projects` só traria o custo: mais I/O de git concorrente num diretório
 * compartilhado, que é de onde vem o resíduo que o `check:local` acusou na primeira execução
 * desta suíte.
 */
describe('retratoDoGit', () => {
  let dir: string
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'rayzen-retrato-git-')) })
  afterEach(() => rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }))

  it('diretório sem repositório é nao-repo, e isso é uma resposta', async () => {
    const r = await retratoDoGit(dir)
    expect(r).toMatchObject({ estado: 'nao-repo', medidoEm: dir })
  }, 20_000)

  it('repositório limpo traz raiz, branch e HEAD', async () => {
    repoComCommit(dir)

    const r = await retratoDoGit(dir)

    expect(r.estado).toBe('repo')
    expect(r.branch).toMatch(/^(main|master)$/)
    expect(r.head).toMatch(/^[0-9a-f]{40}$/)
    expect(r.naoCommitados).toBe(0)
    expect(r.raiz).toBeTruthy()
  }, 20_000)

  /**
   * Trabalho não commitado é REGISTRO, não impedimento — o caminho de reconciliar não roda git
   * nem reescreve arquivo, e bloquear por isso impediria retomar um projeto, que normalmente
   * se retoma justamente porque tem trabalho em andamento.
   */
  it('conta arquivos não commitados sem julgar', async () => {
    repoComCommit(dir)
    writeFileSync(join(dir, 'a.txt'), 'mudou\n')
    writeFileSync(join(dir, 'b.txt'), 'novo\n')

    const r = await retratoDoGit(dir)

    expect(r.estado).toBe('repo')
    expect(r.naoCommitados).toBe(2)
  }, 20_000)

  /**
   * ── O caso que torna o efeito errado ──────────────────────────────────────
   *
   * Uma subpasta SEM `.git` própria, dentro de um repositório, é repositório para o git — a
   * raiz está acima dela. É por isso que `existsSync('.git')` não serve: ele diria "não é
   * repo" e um `git init` ali criaria um repositório aninhado.
   */
  it('subpasta dentro de um repositório é repo, com a raiz ACIMA dela', async () => {
    repoComCommit(dir)
    const dentro = join(dir, 'sub', 'mais-fundo')
    mkdirSync(dentro, { recursive: true })

    const r = await retratoDoGit(dentro)

    expect(r.estado).toBe('repo')
    expect(r.medidoEm).toBe(dentro)
    // A raiz não é o caminho medido — é o repositório que o contém.
    expect(r.raiz?.replace(/\//g, '\\').toLowerCase())
      .toContain(dir.split(/[\\/]/).pop()!.toLowerCase())
  }, 20_000)

  /** Caminho inexistente não dá para medir, e "não consegui olhar" não é "não é repo". */
  it('caminho que não existe é inconclusivo, não nao-repo', async () => {
    const r = await retratoDoGit(join(dir, 'isto-nao-existe'))

    expect(r.estado).toBe('inconclusivo')
    expect(r.motivo).toBeTruthy()
  }, 20_000)
})
