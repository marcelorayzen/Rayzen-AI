import { execFileSync } from 'child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'fs'
import { randomUUID } from 'crypto'
import { join } from 'path'
import { criarWorktree, removerWorktree } from '../workspace-isolado'

/**
 * Extraído de `actions/supervised-session.ts` para `exec/workspace-isolado.ts` em 12/09 (Item
 * A.3 da varredura pós-plano) — `run_command` genérico passou a precisar do MESMO mecanismo
 * de isolamento que a sessão supervisionada já usava, e duplicar seria repetir o erro que o
 * plano de execução tipada existe para evitar.
 *
 * Item A.1 (mesma varredura) fechou "worktree abandonado ocupa disco... falta um coletor"
 * (`docs/RAYZEN_AGENT_PROTOCOL.md`). A cobertura anterior a isso testava só o fallback de "não
 * é repo git" e a geração de TEXTO das instruções — nunca um `criarWorktree`/`removerWorktree`
 * real contra um repositório de verdade. Este arquivo cobre isso.
 */
function git(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
}

function repoComCommit(): string {
  const base = join(process.env.USERPROFILE ?? process.env.HOME ?? '', 'Projects')
  // No runner do CI (Linux, $HOME=/home/runner) esta pasta não existe por padrão — mkdtempSync
  // exige que o pai já exista. Na máquina de dev (Windows) `~/Projects` já existe, é no-op ali.
  mkdirSync(base, { recursive: true })
  const dir = mkdtempSync(join(base, 'rayzen-worktree-real-'))
  git(['init', '-q'], dir)
  git(['config', 'user.email', 'teste@rayzen.local'], dir)
  git(['config', 'user.name', 'Teste'], dir)
  writeFileSync(join(dir, 'README.md'), '# repo de teste\n')
  git(['add', '.'], dir)
  git(['commit', '-q', '-m', 'inicial'], dir)
  return dir
}

// `criarWorktree` deriva o diretório de `id.slice(0, 8)` — determinístico. Um id aleatório por
// teste evita colidir com o diretório de uma rodada ANTERIOR que não tenha limpado (ex.: teste
// interrompido no meio de uma investigação manual).
function idUnico(): string {
  return randomUUID().replace(/-/g, '')
}

describe('criarWorktree / removerWorktree — contra um repositório git real', () => {
  jest.setTimeout(30_000)
  let repo: string
  let worktreeDirs: string[] = []

  beforeEach(() => { repo = repoComCommit(); worktreeDirs = [] })
  afterEach(() => {
    // `maxRetries`/`retryDelay`: no Windows, `git worktree remove` pode devolver o controle
    // antes do SO soltar de vez o handle do diretório-base — sob carga (suíte completa, vários
    // workers de Jest fazendo I/O de git ao mesmo tempo), `rmSync` sem retry esbarra em EBUSY.
    rmSync(repo, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    // Defesa extra: se um teste falhar ANTES de chamar removerWorktree, o diretório em
    // tmpdir() não pode sobreviver para colidir com a próxima rodada.
    for (const dir of worktreeDirs) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  })

  it('criarWorktree cria um diretório de verdade, com branch próprio', async () => {
    const id = idUnico()
    const wt = await criarWorktree(repo, id)
    expect(wt).not.toBeNull()
    worktreeDirs.push(wt!.dir)
    expect(existsSync(wt!.dir)).toBe(true)
    expect(wt!.branch).toBe(`rayzen/sessao-${id.slice(0, 8)}`)

    const branches = git(['branch', '--list', wt!.branch], repo)
    expect(branches).toContain(wt!.branch)
  })

  it('prefixo diferencia o branch/diretório por chamador — run_command não colide com sessão supervisionada', async () => {
    const id = idUnico()
    const wt = await criarWorktree(repo, id, 'cmd')
    expect(wt).not.toBeNull()
    worktreeDirs.push(wt!.dir)
    expect(wt!.branch).toBe(`rayzen/cmd-${id.slice(0, 8)}`)
  })

  it('o repositório do dono nunca muda de HEAD/branch por causa do worktree', async () => {
    const headAntes = git(['rev-parse', 'HEAD'], repo)
    const branchAntes = git(['branch', '--show-current'], repo)

    const wt = await criarWorktree(repo, idUnico())
    if (wt) worktreeDirs.push(wt.dir)

    expect(git(['rev-parse', 'HEAD'], repo)).toBe(headAntes)
    expect(git(['branch', '--show-current'], repo)).toBe(branchAntes)
  })

  it('removerWorktree libera o diretório E apaga o branch quando não há commit novo (nada a perder)', async () => {
    const wt = await criarWorktree(repo, idUnico())
    worktreeDirs.push(wt!.dir)
    expect(existsSync(wt!.dir)).toBe(true)

    const r = await removerWorktree(repo, wt!)

    expect(r.dirRemovido).toBe(true)
    expect(existsSync(wt!.dir)).toBe(false)
    // Branch sem commit próprio é idêntico à base — git aceita `-d` (delete seguro) de bom grado.
    expect(r.branchRemovido).toBe(true)
    expect(git(['branch', '--list', wt!.branch], repo)).toBe('')
  })

  /**
   * O caso que justifica a divisão dirRemovido/branchRemovido: trabalho real e não mesclado
   * NUNCA pode ser perdido por uma limpeza automática. `git branch -d` (minúsculo) é quem
   * garante isso — a mesma trava seria violada por `-D`, que este código nunca usa.
   */
  it('removerWorktree libera o diretório mas PRESERVA o branch quando há commit não mesclado', async () => {
    const wt = await criarWorktree(repo, idUnico())
    worktreeDirs.push(wt!.dir)
    writeFileSync(join(wt!.dir, 'trabalho-em-andamento.txt'), 'não pode sumir')
    git(['add', '.'], wt!.dir)
    git(['commit', '-q', '-m', 'trabalho da sessão, ainda não revisado'], wt!.dir)
    const commitDoTrabalho = git(['rev-parse', wt!.branch], repo)

    const r = await removerWorktree(repo, wt!)

    expect(r.dirRemovido).toBe(true)
    expect(existsSync(wt!.dir)).toBe(false)
    // O branch RECUSOU ser apagado — é o git, não uma checagem nossa reimplementando "mesclado?".
    expect(r.branchRemovido).toBe(false)
    expect(git(['branch', '--list', wt!.branch], repo)).toContain(wt!.branch)
    // E o commit em si sobrevive, alcançável pelo branch — nada foi perdido.
    expect(git(['rev-parse', wt!.branch], repo)).toBe(commitDoTrabalho)
  })

  /**
   * ── A01 da auditoria de 13/09, reproduzido em P7 ──────────────────────────────
   *
   * O teste acima cobre commit NÃO MESCLADO, e `git branch -d` protege esse caso sozinho.
   * O que ninguém cobria era o degrau anterior: trabalho que nem chegou a virar commit.
   * `git worktree remove --force` apagava alteração tracked e arquivo novo sem nada
   * recusar — P7 mediu `uncommittedFilesRemain: false` num repositório git real.
   *
   * A ironia registrada em B0: o comentário acima de `removerWorktree` explicava
   * corretamente por que a limpeza era segura ("só libera o CHECKOUT; os commits continuam
   * alcançáveis pelo branch") — e `--force` era exatamente o que desfazia a premissa,
   * porque sem ele o git RECUSA remover um worktree sujo. A trava existia e estava
   * desligada na mesma linha que o comentário descrevia.
   */
  it('removerWorktree PRESERVA o checkout quando há trabalho não commitado — nunca destrói WIP', async () => {
    const wt = await criarWorktree(repo, idUnico())
    worktreeDirs.push(wt!.dir)

    // As duas formas que o P7 mediu como perdidas, juntas.
    writeFileSync(join(wt!.dir, 'README.md'), '# alterado, sem commit\n')
    writeFileSync(join(wt!.dir, 'nunca-commitado.txt'), 'trabalho que não pode sumir\n')

    const r = await removerWorktree(repo, wt!)

    expect(r.preservadoPorWip).toBe(true)
    expect(r.dirRemovido).toBe(false)
    expect(r.branchRemovido).toBe(false)

    // O que importa: os bytes continuam lá.
    expect(existsSync(wt!.dir)).toBe(true)
    expect(existsSync(join(wt!.dir, 'nunca-commitado.txt'))).toBe(true)
    expect(readFileSync(join(wt!.dir, 'README.md'), 'utf8')).toContain('alterado, sem commit')

    // E o branch continua sendo a referência para achar o trabalho.
    expect(git(['branch', '--list', wt!.branch], repo)).toContain(wt!.branch)
  })

  /**
   * O outro lado da mesma regra: limpeza normal continua acontecendo. Sem isto, "preservar"
   * viraria "nunca mais remover nada", e todo worktree vazaria em disco — o teste que impede
   * a correção de virar um problema diferente.
   */
  it('worktree limpo continua sendo removido normalmente — preservar não vira nunca limpar', async () => {
    const wt = await criarWorktree(repo, idUnico())
    worktreeDirs.push(wt!.dir)

    const r = await removerWorktree(repo, wt!)

    expect(r.preservadoPorWip).toBeFalsy()
    expect(r.dirRemovido).toBe(true)
    expect(existsSync(wt!.dir)).toBe(false)
  })

  it('removerWorktree é best-effort — diretório já removido não impede tentar o branch', async () => {
    const wt = await criarWorktree(repo, idUnico())
    worktreeDirs.push(wt!.dir)
    await removerWorktree(repo, wt!) // primeira remoção, normal

    // Segunda chamada sobre o MESMO worktree (já removido) não deve lançar.
    await expect(removerWorktree(repo, wt!)).resolves.toMatchObject({ dirRemovido: false })
  })
})
