import { execFileSync } from 'child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { runCommand } from '../terminal'
import { decidir } from '../../exec/decidir'

/**
 * Item A.3 da varredura pós-plano (12/09) — workspace isolado por invocação para `run_command`
 * genérico. Os testes de Fase 5 (`terminal-fase5-red.spec.ts`) mockam `child_process` inteiro
 * (só `execSync`), então `criarWorktree()` (que usa `spawn` por baixo de `executarPrograma`)
 * falha ali e `decidir()` degrada silenciosamente para o `workdir` sem isolamento — o que
 * prova a degradação funciona, mas não prova o isolamento REAL. Este arquivo usa um
 * repositório git de verdade e `child_process` real, para provar o caminho feliz.
 */
function git(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
}

// No runner do CI (Linux, $HOME=/home/runner) esta pasta não existe por padrão — mkdtempSync
// exige que o pai já exista. Máquina de dev real (Windows) já tem `~/Projects`, então o
// mkdirSync abaixo é no-op ali.
function projectsBase(): string {
  const base = join(process.env.USERPROFILE ?? process.env.HOME ?? '', 'Projects')
  mkdirSync(base, { recursive: true })
  return base
}

function repoComCommit(): string {
  const dir = mkdtempSync(join(projectsBase(), 'rayzen-cmd-isolado-'))
  git(['init', '-q'], dir)
  git(['config', 'user.email', 'teste@rayzen.local'], dir)
  git(['config', 'user.name', 'Teste'], dir)
  writeFileSync(join(dir, 'README.md'), '# repo de teste\n')
  git(['add', '.'], dir)
  git(['commit', '-q', '-m', 'inicial'], dir)
  return dir
}

describe('decidir() — workspace isolado por invocação (Item A.3), contra repositório real', () => {
  jest.setTimeout(30_000)
  let repo: string
  const original = { token: process.env.AGENT_TOKEN, fetch: global.fetch }

  beforeEach(() => {
    repo = repoComCommit()
    process.env.AGENT_TOKEN = 't'
    global.fetch = jest.fn().mockResolvedValue({
      ok: true, json: () => Promise.resolve({ ok: true, id: 'apr-1', createdBy: 'teste' }),
    }) as unknown as typeof fetch
  })

  afterEach(() => {
    // `maxRetries`/`retryDelay`: no Windows, `git worktree remove` (dentro de `runCommand()`,
    // via `finally` de `terminal.ts`) pode devolver o controle antes do SO soltar de vez o
    // handle do diretório-base — sem retry, `rmSync` aqui esbarra em EBUSY sob carga (suíte
    // completa, vários workers de Jest fazendo I/O de git ao mesmo tempo). Medido: nunca
    // reproduz isolado, só sob `pnpm test` na raiz.
    rmSync(repo, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
    if (original.token === undefined) delete process.env.AGENT_TOKEN
    else process.env.AGENT_TOKEN = original.token
    global.fetch = original.fetch
  })

  it('aprovado e não-dryRun: workdir vira um worktree isolado, diferente da base', async () => {
    const decisao = await decidir({ role: 'desktop', command: 'git status', path: repo })

    expect(decisao.permitido).toBe(true)
    expect(decisao.workspaceIsolado).toBeDefined()
    expect(decisao.workspaceIsolado!.base).toBe(repo)
    expect(decisao.workdir).toBe(decisao.workspaceIsolado!.worktree.dir)
    expect(decisao.workdir).not.toBe(repo)
  })

  it('dryRun nunca isola — não há execução, não há por que criar workspace', async () => {
    const decisao = await decidir({ role: 'desktop', command: 'git status', path: repo, dryRun: true })

    expect(decisao.workspaceIsolado).toBeUndefined()
    expect(decisao.workdir).toBe(repo)
  })

  it('runCommand executa de ponta a ponta E limpa o worktree depois — repo do dono nunca muda', async () => {
    const headAntes = git(['rev-parse', 'HEAD'], repo)

    const r = await runCommand({ command: 'git status', path: repo })

    expect(r.skipped).toBe(false)
    // O HEAD do repositório REAL nunca se move — a execução aconteceu no worktree, não aqui.
    expect(git(['rev-parse', 'HEAD'], repo)).toBe(headAntes)
    // E nenhum worktree ficou pendurado depois que runCommand() retornou.
    expect(git(['worktree', 'list'], repo)).not.toMatch(/rayzen-worktree/)
  })

  /**
   * Não é git (ou o worktree falha por outro motivo): degrada para a base real em vez de
   * recusar — mesma filosofia da sessão supervisionada. A aprovação humana já é a barreira
   * que importa; falhar aqui jogaria fora uma execução já aprovada.
   */
  it('fora de repositório git, degrada para a base real sem isolar', async () => {
    const dirSemGit = mkdtempSync(join(projectsBase(), 'rayzen-sem-git-'))
    try {
      const decisao = await decidir({ role: 'desktop', command: 'git status', path: dirSemGit })
      expect(decisao.permitido).toBe(true)
      expect(decisao.workspaceIsolado).toBeUndefined()
      expect(decisao.workdir).toBe(dirSemGit)
    } finally {
      rmSync(dirSemGit, { recursive: true, force: true })
    }
  })

  /**
   * Achado ao escrever este arquivo: com o isolamento caindo para `process.cwd()` na ausência
   * de `path` (esboço inicial), qualquer teste do MONOREPO que chame `runCommand`/`decidir`
   * sem `path` (ex.: `composicao-de-camadas.spec.ts`) criaria um worktree de verdade contra o
   * REPOSITÓRIO REAL do rayzen-ai — `process.cwd()` durante os testes é `apps/agent`,
   * subdiretório do mesmo repo. Corrigido: sem `path`, não há isolamento, `workdir` fica
   * `undefined` e a execução cai no `process.cwd()` sem passar por `criarWorktree()` — igual
   * a antes do Item A.3.
   */
  it('sem path (workdir ausente), NÃO isola — nunca toca o checkout real do agent', async () => {
    const decisao = await decidir({ role: 'desktop', command: 'git status' })
    expect(decisao.permitido).toBe(true)
    expect(decisao.workspaceIsolado).toBeUndefined()
    expect(decisao.workdir).toBeUndefined()
  })
})
