import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { fileSearch } from '../file-search'
import { parseTestReport } from '../parse-test-report'
import { captureTestFailure } from '../capture-test-failure'

/**
 * Achado da varredura de 2026-09-12: `file-search.ts`, `parse-test-report.ts`,
 * `capture-test-failure.ts` e `create-project-folder.ts` tinham CADA UMA a sua própria cópia
 * de `SAFE_ROOTS`, checada com `path.startsWith(root)` — comparação de PREFIXO, não de
 * fronteira de diretório (`C:\ProjectsEvil` "começa com" `C:\Projects`). As quatro listas
 * também não liam `AGENT_PROJECT_ROOT`, e podiam divergir da canônica em silêncio.
 *
 * As quatro passaram a importar `isUnderSafeRoot()` de `utils/path-guard.ts`. Este arquivo
 * prova, para as três que não tinham teste nenhum antes (`create-project-folder.ts` já tinha
 * cobertura própria), que a troca preserva o caso legítimo (`C:\Projects\...`) e fecha o bug
 * de prefixo.
 */
describe('consolidação de SAFE_ROOTS — fileSearch/parseTestReport/captureTestFailure', () => {
  // Caminho com letra de unidade só existe no Windows — no runner Linux do CI, `C:\Projects`
  // nunca é reconhecido como absoluto, e path-guard recusa antes mesmo do que este teste prova.
  const itWindows = process.platform === 'win32' ? it : it.skip

  itWindows('fileSearch aceita C:\\Projects (a lista ad-hoc já aceitava, a canônica precisou ganhar isso)', async () => {
    // Sem asserir o CONTEÚDO da busca (que dependeria do disco real) — só que o path-guard
    // não bloqueia antes de sequer tentar.
    await expect(fileSearch({ query: 'nada-que-exista-9x7', path: 'C:\\Projects' }))
      .resolves.toMatchObject({ total: 0 })
  })

  it('fileSearch rejeita caminho fora de qualquer safe root', async () => {
    await expect(fileSearch({ query: 'x', path: 'C:\\Windows\\System32' }))
      .rejects.toThrow(/Caminho não permitido/)
  })

  it('parseTestReport rejeita reportPath fora de safe root, antes de tentar ler o arquivo', async () => {
    await expect(parseTestReport({ reportPath: 'C:\\Windows\\System32\\report.xml' }))
      .rejects.toThrow(/Caminho não permitido/)
  })

  itWindows('parseTestReport aceita reportPath em C:\\Projects (case real das 4 cópias ad-hoc)', async () => {
    // Path aceito pelo guard, mas o arquivo não existe — prova que a recusa NÃO veio do
    // path-guard, veio do passo seguinte ("Arquivo não encontrado").
    await expect(parseTestReport({ reportPath: 'C:\\Projects\\relatorio-que-nao-existe-9x7.xml' }))
      .rejects.toThrow(/Arquivo não encontrado/)
  })

  it('captureTestFailure rejeita projectPath fora de safe root', async () => {
    await expect(captureTestFailure({ projectPath: 'C:\\Windows\\System32' }))
      .rejects.toThrow(/Caminho não permitido/)
  })

  /**
   * O bug específico que a consolidação fecha: as 4 listas ad-hoc usavam `.startsWith()`,
   * então um diretório cujo NOME começa com "Projects" mas não é subdiretório dele (ex.:
   * `C:\ProjectsEvil`) passava. `isUnderSafeRoot()` usa `relative()` e não tem esse defeito.
   */
  it('fileSearch rejeita C:\\ProjectsEvil — prefixo de string, não subdiretório real', async () => {
    await expect(fileSearch({ query: 'x', path: 'C:\\ProjectsEvil\\arquivo.ts' }))
      .rejects.toThrow(/Caminho não permitido/)
  })

  it('captureTestFailure rejeita C:\\ProjectsEvil pelo mesmo motivo', async () => {
    await expect(captureTestFailure({ projectPath: 'C:\\ProjectsEvil' }))
      .rejects.toThrow(/Caminho não permitido/)
  })
})

/**
 * Confirma que a checagem migrada continua funcionando com um repositório real, não só com
 * caminhos hipotéticos que nunca tocam disco.
 */
describe('fileSearch — contra um diretório real dentro de HOME/Projects', () => {
  let dir: string

  beforeEach(() => {
    const base = join(process.env.USERPROFILE ?? process.env.HOME ?? '', 'Projects')
    // No runner do CI (Linux, $HOME=/home/runner) esta pasta não existe por padrão.
    mkdirSync(base, { recursive: true })
    dir = mkdtempSync(join(base, 'rayzen-safe-root-teste-'))
    writeFileSync(join(dir, 'alvo-de-busca.txt'), 'conteudo')
  })

  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('encontra o arquivo dentro de um subdiretório real de Projects', async () => {
    const r = await fileSearch({ query: 'alvo-de-busca', path: dir })
    expect(r.total).toBe(1)
    expect(r.results[0].name).toBe('alvo-de-busca.txt')
  })
})
