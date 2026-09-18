import { readFileSync } from 'fs'
import { execFileSync } from 'child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { gitInitCommit } from '../create-project-folder'

/**
 * Migração da Fase 1: `git init/add/commit` montava `git commit -m "chore: … ${name}"` —
 * `name` vem do payload de `jarvis:create_project_folder` (nome de projeto digitado por
 * alguém) e a Fase 0 marcou isso como "a verificar" sem nunca fechar.
 *
 * O teste real está aqui, não em `executar-programa.spec.ts`: prova que a mensagem de commit
 * chega literal ao `git log`, não que um argv genérico chega literal a um `node -e`.
 */
const NO_WINDOWS = process.platform === 'win32' ? it : it.skip

describe('create-project-folder — git init/commit sem montar string (Fase 1)', () => {
  const fonte = readFileSync(join(__dirname, '..', 'create-project-folder.ts'), 'utf8')

  it('não importa mais execSync', () => {
    expect(fonte).not.toMatch(/from 'child_process'/)
  })

  it('a mensagem de commit vai como elemento de argv, nunca dentro de template string', () => {
    expect(fonte).toMatch(/\['commit', '-m', mensagemDeCommit\]/)
  })

  it('abertura do VS Code passa por entrypointJs, não por string montada', () => {
    expect(fonte).toMatch(/executarPrograma\('entrypointJs', 'code'/)
  })

  it('remoção de .git usa fs.rm nativo, não rd/rm de shell', () => {
    expect(fonte).not.toMatch(/rd \/s \/q|rm -rf/)
    expect(fonte).toMatch(/await rm\(join\(projectPath, '\.git'\)/)
  })

  NO_WINDOWS('nome de projeto com metacaractere chega literal no commit real', async () => {
    const repo = mkdtempSync(join(tmpdir(), 'rayzen-cpf-fase1-'))
    writeFileSync(join(repo, 'arquivo.txt'), 'conteudo')

    const nomeAdversarial = 'projeto"; rm -rf / #`whoami`$(whoami)'
    const ok = await gitInitCommit(repo, `chore: inicializar projeto ${nomeAdversarial} via Rayzen AI`)
    expect(ok).toBe(true)

    const mensagem = execFileSync('git', ['-C', repo, 'log', '-1', '--format=%s'], { encoding: 'utf8' }).trim()
    expect(mensagem).toBe(`chore: inicializar projeto ${nomeAdversarial} via Rayzen AI`)

    rmSync(repo, { recursive: true, force: true })
  })

  NO_WINDOWS('sem git no PATH ou fora de diretório gravável, devolve false — nunca lança', async () => {
    const ok = await gitInitCommit('C:\\caminho\\que\\nao\\existe\\9x7', 'chore: nunca deveria commitar')
    expect(ok).toBe(false)
  })
})
