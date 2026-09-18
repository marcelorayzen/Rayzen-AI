import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'fs'
import { join } from 'path'
import { runTests } from '../run-tests'

/**
 * Achado emergencial em 11/09, mesma classe de `git.ts`/`prisma.ts` — e o pior dos três:
 * SEIS pontos de injeção, um por runner (jest, vitest, playwright, pytest, maven, gradle,
 * newman), todos pela mesma forma — `filter`/`collectionPath`/`environment` interpolados
 * dentro de aspas duplas de uma string de comando, montada num `switch` várias linhas antes
 * da chamada `execSync`. `jarvis:run_tests` é ação de uso diário, disponível ao `desktop`.
 *
 * `playwright`/`newman`/`mvn`/`gradle` de verdade NÃO estão instalados neste monorepo —
 * mesma honestidade que `RESEARCH/hermes.md` já pratica ("nada foi instalado, executado ou
 * verificado"). O que dá para provar sem eles:
 *   - jest/vitest via pnpm: RODA de verdade contra este próprio pacote.
 *   - gradle: um `gradlew.bat` de MENTIRA que só ecoa o argv recebido prova a técnica
 *     `cmd.exe /c <script> <argv...>` ponta a ponta, através da função real `runTests`.
 *   - playwright/newman: sem o pacote instalado, a prova é que FALHA LIMPO (mensagem clara),
 *     nunca com o valor adversarial encadeado.
 */
const NO_WINDOWS = process.platform === 'win32' ? describe : describe.skip
const MARCADOR = 'INJETADO-RUNTESTS-9f7'

function projetoTemporario(): string {
  const base = join(process.env.USERPROFILE ?? process.env.HOME ?? '', 'Projects')
  mkdirSync(base, { recursive: true })
  return mkdtempSync(join(base, 'rayzen-run-tests-fase1-'))
}

NO_WINDOWS('runTests — jest via pnpm, contra este pacote de verdade', () => {
  const AGENT_ROOT = join(process.env.USERPROFILE ?? '', 'Projects', 'rayzen-ai', 'apps', 'agent')

  it('filter adversarial chega literal ao --testNamePattern, sem encadear', async () => {
    const filtroAdversarial = `x" & echo ${MARCADOR} & echo "`
    // Roda de verdade: 0 testes vão casar esse nome (não existe), então jest sai com
    // "no tests found" — o que importa é que o & não vira comando à parte.
    const r = await runTests({ projectPath: AGENT_ROOT, runner: 'jest', filter: filtroAdversarial })
    expect(r.rawOutput).not.toMatch(new RegExp(`^${MARCADOR}$`, 'm'))
  }, 60_000)
})

NO_WINDOWS('runTests — gradle via cmd.exe /c, com um gradlew.bat de mentira', () => {
  let projeto: string
  beforeEach(() => { projeto = projetoTemporario() })
  afterEach(() => { try { rmSync(projeto, { recursive: true, force: true }) } catch { /* ok */ } })

  it('argv chega literal ao script, & não encadeia comando', async () => {
    // O script de mentira ecoa CADA argumento recebido, um por linha — prova exatamente o
    // que o Node passou ao Win32, sem depender de gradle de verdade existir.
    writeFileSync(join(projeto, 'gradlew.bat'), '@echo off\r\nfor %%A in (%*) do echo ARG:%%A\r\n', 'utf8')

    const filtroAdversarial = `MinhaClasse & echo ${MARCADOR} & echo x`
    const r = await runTests({ projectPath: projeto, runner: 'gradle', filter: filtroAdversarial })

    // Prova real (medida, não suposta): o Windows aspas-protege automaticamente o argv que
    // contém espaço ao montar a linha do Win32, então o valor INTEIRO chega como UM só
    // "ARG:" — com as aspas — em vez de virar três argumentos (MinhaClasse / & / echo...).
    // Saída de fato observada: `ARG:"MinhaClasse & echo INJETADO... & echo x"`.
    expect(r.rawOutput).toMatch(new RegExp(`ARG:"?${filtroAdversarial.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"?`))
    // Se o cmd.exe tivesse encadeado o `&` como separador de comando, o `echo` do meio teria
    // rodado À PARTE e produzido uma linha "ARG:" a mais — só deve haver 3 linhas ARG: no total
    // (test, --tests, o valor inteiro), nunca 5.
    const linhasArg = r.rawOutput.split('\n').filter(l => l.startsWith('ARG:'))
    expect(linhasArg).toHaveLength(3)
  }, 30_000)
})

NO_WINDOWS('runTests — playwright/newman sem instalação real falham limpo', () => {
  let projeto: string
  beforeEach(() => { projeto = projetoTemporario() })
  afterEach(() => { try { rmSync(projeto, { recursive: true, force: true }) } catch { /* ok */ } })

  it('playwright ausente falha com mensagem clara, não com valor encadeado', async () => {
    const filtroAdversarial = `x" & echo ${MARCADOR} & echo "`
    await expect(runTests({ projectPath: projeto, runner: 'playwright', filter: filtroAdversarial }))
      .rejects.toThrow(/não encontrado em node_modules\/\.bin/)
  })

  it('newman ausente falha com mensagem clara, não com valor encadeado', async () => {
    const collectionAdversarial = `x.json" & echo ${MARCADOR} & echo "`
    await expect(runTests({ projectPath: projeto, runner: 'newman', collectionPath: collectionAdversarial }))
      .rejects.toThrow(/não encontrado em node_modules\/\.bin/)
  })
})

describe('run-tests.ts — código não volta a montar comando por template', () => {
  const fonte = readFileSync(join(__dirname, '..', 'run-tests.ts'), 'utf8')
    .split(/\r?\n/).filter(l => !/^\s*\*|^\s*\/\//.test(l)).join('\n')

  it('não importa mais execSync/exec de child_process', () => {
    expect(fonte).not.toMatch(/from 'child_process'/)
  })

  it('filter/collection nunca entram numa template string com ESPAÇO (comando de vários tokens)', () => {
    // Um template literal de UM argv só, tipo `-Dtest=${filter}` ou `--testNamePattern=${filter}`,
    // é seguro — vira UM elemento do array, nunca uma linha de comando. O que seria perigoso é
    // um valor com ESPAÇO interno (várias flags coladas), que é exatamente o padrão antigo.
    const perigoso = /`[^`]*\s[^`]*\$\{(filter|collection|payload\.environment)\}[^`]*`|`[^`]*\$\{(filter|collection|payload\.environment)\}[^`]*\s[^`]*`/
    expect(fonte).not.toMatch(perigoso)
  })

  it('todos os sete runners despacham por executarPrograma, nunca por execSync', () => {
    expect(fonte).toMatch(/rodarViaPnpm/)
    expect(fonte).toMatch(/rodarBinLocal/)
    expect(fonte).toMatch(/rodarViaCmdScript/)
    expect(fonte).toMatch(/'executavel', 'pytest'/)
  })

  it('usa ambientePadrao(), nunca process.env espalhado', () => {
    expect(fonte).toMatch(/env: ambientePadrao\(\)/g)
    expect(fonte).not.toMatch(/\.\.\.process\.env/)
  })
})
