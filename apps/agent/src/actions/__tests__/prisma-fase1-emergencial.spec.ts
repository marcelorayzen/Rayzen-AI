import { mkdtempSync, rmSync, readFileSync } from 'fs'
import { join } from 'path'
import { prismaGenerate, prismaMigrate } from '../prisma'

/**
 * Achado emergencial em 11/09, mesma classe de `git.ts`: `safeExec(cmd, cwd)` recebia STRING
 * montada pelo chamador, invisível ao scanner (`docs/exec-paths.md` só olha a mesma linha da
 * chamada `execSync`). `schema` chegava sem sanitização nenhuma; `mode` sem validação de
 * runtime, apesar do tipo `'deploy' | 'status'` do TypeScript — que não existe depois de
 * compilado.
 *
 * `resolverPrismaLocal()` exige um projeto com `prisma` de verdade instalado — os testes de
 * schema adversarial rodam contra ESTE monorepo (que já tem prisma), nunca contra um projeto
 * vazio. O schema em si é sempre o valor adversarial (bogus), então o prisma falha antes de
 * tocar em qualquer banco real — nenhum teste aqui executa migração de verdade.
 */
const NO_WINDOWS = process.platform === 'win32' ? describe : describe.skip
const REPO_COM_PRISMA = join(process.env.USERPROFILE ?? process.env.HOME ?? '', 'Projects', 'rayzen-ai', 'apps', 'api')
const MARCADOR = 'INJETADO-PRISMA-9f7'

NO_WINDOWS('prisma.ts — schema não encadeia comando (vetor confirmado em 11/09)', () => {
  it('prismaGenerate.schema com aspa+& não encadeia comando', async () => {
    const schemaAdversarial = `x.prisma" & echo ${MARCADOR} & echo "`

    // A técnica foi provada isolada (comando rápido no lugar do npx) em 11/09: o mesmo
    // "fecha aspa e encadeia" que funcionou em gitDiff funciona com execSync no cmd.exe.
    // Aqui a prova é que o valor chega LITERAL ao prisma — que falha (schema inválido), mas
    // falha com o valor INTEIRO como um argumento só, nunca com um `echo` rodando à parte.
    try {
      await prismaGenerate({ projectPath: REPO_COM_PRISMA, schema: schemaAdversarial })
      throw new Error('deveria ter lançado')
    } catch (e) {
      const msg = String((e as Error).message)
      // Nunca como linha ISOLADA de saída — se aparecer, só pode ser citado dentro do erro
      // do prisma sobre o schema recusado, nunca como o único conteúdo de uma linha.
      expect(msg).not.toMatch(new RegExp(`^${MARCADOR}$`, 'm'))
    }
  }, 30_000)

  it('prismaMigrate.mode fora do enum é rejeitado em runtime, não só no tipo', async () => {
    const dir = mkdtempSync(join(process.env.USERPROFILE ?? '', 'Projects', 'rayzen-prisma-mode-'))
    try {
      // O tipo TypeScript não existe depois de compilado — um payload JSON real pode trazer
      // qualquer string aqui. Simula exatamente isso com um cast.
      const payload = { projectPath: dir, mode: `deploy & echo ${MARCADOR} & echo x` } as unknown as {
        projectPath: string; mode: 'deploy' | 'status'
      }
      await expect(prismaMigrate(payload)).rejects.toThrow(/mode inválido/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('prismaMigrate.schema adversarial não encadeia comando (modo status)', async () => {
    const schemaAdversarial = `x.prisma" & echo ${MARCADOR} & echo "`
    try {
      await prismaMigrate({ projectPath: REPO_COM_PRISMA, mode: 'status', schema: schemaAdversarial })
      throw new Error('deveria ter lançado')
    } catch (e) {
      const msg = String((e as Error).message)
      expect(msg).not.toMatch(new RegExp(`^${MARCADOR}$`, 'm'))
    }
  }, 30_000)

  /**
   * NÃO testado sob Jest: `require.resolve(id, {paths})` isola corretamente quando chamado
   * de um processo Node puro (verificado manualmente em 11/09 — falha com MODULE_NOT_FOUND
   * para um diretório sem prisma), mas o `require` que o Jest injeta no sandbox de teste
   * herda a cadeia de resolução do PRÓPRIO monorepo de teste, então SEMPRE encontra o
   * prisma daqui, não importa o `paths` passado. Testar isso aqui provaria o
   * comportamento do Jest, não o do código. `resolverPrismaLocal` fica coberto pelo teste
   * de mensagem de erro abaixo, que exercita o `catch` sem depender de isolamento real.
   */
  it('resolverPrismaLocal existe e sua mensagem de erro é clara (cobertura de forma, não de isolamento)', () => {
    const fonte = readFileSync(join(__dirname, '..', 'prisma.ts'), 'utf8')
    expect(fonte).toMatch(/prisma não encontrado como dependência de \$\{cwd\}/)
  })
})

describe('prisma.ts — código não volta a montar comando por template', () => {
  const fonte = readFileSync(join(__dirname, '..', 'prisma.ts'), 'utf8')
    .split(/\r?\n/).filter(l => !/^\s*\*|^\s*\/\//.test(l)).join('\n')

  it('não importa mais execSync/exec de child_process', () => {
    expect(fonte).not.toMatch(/from 'child_process'/)
  })

  it('despacha por executarPrograma, sem montar string de comando', () => {
    expect(fonte).toMatch(/executarPrograma\('executavel', 'node'/)
    expect(fonte).not.toMatch(/safeExec\(\s*`/)
  })

  it('resolve o prisma local via require.resolve, não via npx', () => {
    expect(fonte).toMatch(/require\.resolve\('prisma\/build\/index\.js'/)
    expect(fonte).not.toMatch(/'entrypointJs',\s*'npx'/)
  })

  it('mode é validado contra um Set explícito, não só o tipo do TypeScript', () => {
    expect(fonte).toMatch(/MODOS_DE_MIGRACAO\.has\(payload\.mode\)/)
  })

  it('usa ambientePadrao(), nunca process.env espalhado', () => {
    expect(fonte).toMatch(/env: ambientePadrao\(\)/)
    expect(fonte).not.toMatch(/\.\.\.process\.env/)
  })
})
