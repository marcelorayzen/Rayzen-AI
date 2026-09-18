import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { readFileSync } from 'fs'
import { execFileSync } from 'child_process'
import { join } from 'path'
import {
  gitStatus, gitLog, gitBranch, gitDiff, gitPush, gitAdd, gitCommit,
} from '../git'

/**
 * `git.ts` nunca foi tocado pela Fase 0 — o scanner (`scan-exec-paths.mjs`) só olha a MESMA
 * LINHA da chamada `execSync`, e aqui a interpolação acontecia numa template string montada
 * pelo CHAMADOR e passada como parâmetro para `safeExec(cmd, cwd)`, uma linha de distância.
 * Achado ao desenhar a Fase 2, não pela varredura.
 *
 * Três vetores confirmados AO VIVO em 11/09 (não por análise — rodados de verdade contra um
 * repo de teste isolado, no `cmd.exe`, que é o shell real do `execSync` no Windows):
 *
 *   gitDiff.file    → fecha aspa com `"` e encadeia com `&`         → INJETADO impresso
 *   gitPush.branch  → sem aspa nenhuma, `&` funciona direto         → mesma classe
 *   gitCommit.message → `%VAR%` do cmd.exe expande DENTRO de aspas → segredo gravado no commit
 *
 * Estes testes rodam contra repositórios git de verdade, criados e destruídos a cada caso —
 * é o único jeito de provar ausência de injeção sem reconstruir o parser do cmd.exe à mão.
 */
const NO_WINDOWS = process.platform === 'win32' ? describe : describe.skip

/**
 * `isUnderSafeRoot()` recusa qualquer caminho fora de `SAFE_ROOTS` (`~/Projects`,
 * `~/Desktop`, `~/Documents`, `~/Downloads`) — `%TEMP%` fica de fora de propósito, e foi
 * exatamente essa recusa que a primeira rodada destes testes pegou (o path-guard fazendo o
 * trabalho dele, não um defeito). O fixture precisa nascer DENTRO de um root seguro.
 */
function repoTemporario(): string {
  const base = join(process.env.USERPROFILE ?? process.env.HOME ?? '', 'Projects')
  mkdirSync(base, { recursive: true })
  const dir = mkdtempSync(join(base, 'rayzen-git-fase1-'))
  execFileSync('git', ['init', '-q'], { cwd: dir })
  execFileSync('git', ['config', 'user.email', 'teste@rayzen.local'], { cwd: dir })
  execFileSync('git', ['config', 'user.name', 'Teste Rayzen'], { cwd: dir })
  writeFileSync(join(dir, 'a.txt'), 'conteudo original\n', 'utf8')
  execFileSync('git', ['add', 'a.txt'], { cwd: dir })
  execFileSync('git', ['commit', '-q', '-m', 'commit inicial'], { cwd: dir })
  return dir
}

/** O marcador aparece na SAÍDA CAPTURADA se, e só se, o cmd.exe encadeou o comando. */
const MARCADOR = 'INJETADO-DE-VERDADE-9f7'

NO_WINDOWS('git.ts — os três vetores confirmados não executam mais nada', () => {
  let repo: string

  beforeEach(() => { repo = repoTemporario() })
  afterEach(() => { try { rmSync(repo, { recursive: true, force: true }) } catch { /* ok */ } })

  it('gitDiff.file com aspa+& não encadeia comando (vetor confirmado em 11/09)', async () => {
    writeFileSync(join(repo, 'a.txt'), 'mudou\n', 'utf8')
    const payload = { path: repo, file: `a.txt" & echo ${MARCADOR} & echo "` }

    const r = await gitDiff(payload)

    expect(r.diff).not.toContain(MARCADOR)
    // O git recebe o valor INTEIRO como um único pathspec (que não existe) — falha limpa,
    // não silêncio: prova que o argv chegou intacto, não que a chamada "deu certo por acaso".
  })

  it('gitPush.branch com & não encadeia comando (vetor confirmado em 11/09)', async () => {
    const branchAdversarial = `main & echo ${MARCADOR} & echo x`
    // A prova certa não é "o marcador não aparece" — ele APARECE, porque o git ecoa o
    // refspec inválido inteiro na própria mensagem de erro. A prova é COMO ele aparece:
    // citado inteiro, como UM valor recusado — nunca como saída independente de um `echo`
    // que tivesse rodado à parte (o que provaria que o cmd.exe dividiu o comando).
    try {
      await gitPush({ path: repo, branch: branchAdversarial })
      throw new Error('deveria ter lançado')
    } catch (e) {
      const msg = String((e as Error).message)
      expect(msg).toMatch(/invalid refspec/i)
      expect(msg).toContain(branchAdversarial) // citado INTEIRO, como um valor só
    }
  })

  it('gitPush.branch começando com "-" é rejeitado antes de chegar ao git', async () => {
    await expect(gitPush({ path: repo, branch: '--upload-pack=/tmp/evil' }))
      .rejects.toThrow(/não pode começar com "-"/)
  })

  it('gitCommit.message com %VAR% não expande variável de ambiente (vetor confirmado em 11/09)', async () => {
    process.env.RAYZEN_SEGREDO_DE_TESTE = 'valor-que-nao-pode-vazar'
    writeFileSync(join(repo, 'a.txt'), 'mudou para o teste de %VAR%\n', 'utf8')
    try {
      const r = await gitCommit({ path: repo, message: 'fix: %RAYZEN_SEGREDO_DE_TESTE%' })

      expect(r.message).toBe('fix: %RAYZEN_SEGREDO_DE_TESTE%')
      const logMsg = execFileSync('git', ['log', '-1', '--format=%s'], { cwd: repo, encoding: 'utf8' }).trim()
      // A prova real: o commit GRAVADO não pode conter o valor do segredo.
      expect(logMsg).toBe('fix: %RAYZEN_SEGREDO_DE_TESTE%')
      expect(logMsg).not.toContain('valor-que-nao-pode-vazar')
    } finally {
      delete process.env.RAYZEN_SEGREDO_DE_TESTE
    }
  })

  it('gitCommit.message com & não encadeia comando', async () => {
    writeFileSync(join(repo, 'a.txt'), 'mudou para o teste de &\n', 'utf8')
    const r = await gitCommit({ path: repo, message: `fix: ok & echo ${MARCADOR} & echo x` })
    // A mensagem devolvida DEVE conter o marcador — é só o eco do payload. A prova real é
    // que o git GRAVOU a mesma string literal, sem nada extra ter rodado por fora.
    expect(r.message).toBe(`fix: ok & echo ${MARCADOR} & echo x`)
    const logMsg = execFileSync('git', ['log', '-1', '--format=%s'], { cwd: repo, encoding: 'utf8' }).trim()
    expect(logMsg).toBe(`fix: ok & echo ${MARCADOR} & echo x`)
  })

  it('gitBranch.name tenta virar flag (--upload-pack=x) e é rejeitado', async () => {
    await expect(gitBranch({ path: repo, name: '--upload-pack=/tmp/evil' }))
      .rejects.toThrow(/não pode começar com "-"/)
  })

  it('gitAdd com nome de arquivo adversarial não encadeia comando', async () => {
    const nomeAdversarial = `x.txt" & echo ${MARCADOR} & echo "`
    writeFileSync(join(repo, 'b.txt'), 'novo arquivo\n', 'utf8')

    // `git add` recusa por padrão quando um pathspec não casa NENHUM arquivo (não é
    // "ignora e segue" — verificado agora, não presumido). A prova de ausência de injeção
    // é a mesma do gitPush: o erro cita o valor adversarial INTEIRO como pathspec recusado,
    // nunca como comando que rodou à parte.
    try {
      await gitAdd({ path: repo, files: ['b.txt', nomeAdversarial] })
      throw new Error('deveria ter lançado')
    } catch (e) {
      const msg = String((e as Error).message)
      expect(msg).toMatch(/did not match any files/i)
      expect(msg).toContain(nomeAdversarial)
    }
    // E o arquivo legítimo não pode ter sido stageado por um comando que rodou por fora.
    const status = execFileSync('git', ['status', '--short'], { cwd: repo, encoding: 'utf8' })
    expect(status).not.toContain(MARCADOR)
  })

  it('fluxo funcional continua igual: status → commit → log', async () => {
    writeFileSync(join(repo, 'a.txt'), 'mudou de novo\n', 'utf8')
    const status = await gitStatus({ path: repo })
    expect(status.changed).toBe(1)

    await gitCommit({ path: repo, message: 'segunda mudança' })
    const log = await gitLog({ path: repo, limit: 5 })
    expect(log.commits[0].message).toBe('segunda mudança')
    expect(log.commits).toHaveLength(2)
  })
})

describe('git.ts — código não volta a montar comando por template', () => {
  const fonte = readFileSync(join(__dirname, '..', 'git.ts'), 'utf8')
    .split(/\r?\n/).filter(l => !/^\s*\*|^\s*\/\//.test(l)).join('\n')

  it('não importa mais execSync/exec de child_process', () => {
    expect(fonte).not.toMatch(/from 'child_process'/)
  })

  it('despacha por executarPrograma com estratégia executavel', () => {
    expect(fonte).toMatch(/executarPrograma\('executavel', 'git'/)
  })

  it('nenhuma chamada de safeExec recebe template string em vez de array', () => {
    // A checagem é sobre a CHAMADA (`safeExec(` seguido de crase), não sobre o texto do
    // arquivo em geral — a mensagem de erro de `safeExec` legitimamente descreve o comando
    // com uma template string (`` `git ${args.join(' ')} falhou` ``), e isso não é o defeito.
    expect(fonte).not.toMatch(/safeExec\(\s*`/)
  })

  it('usa ambientePadrao(), nunca process.env espalhado', () => {
    expect(fonte).toMatch(/env: ambientePadrao\(\)/)
    expect(fonte).not.toMatch(/\.\.\.process\.env/)
  })
})
