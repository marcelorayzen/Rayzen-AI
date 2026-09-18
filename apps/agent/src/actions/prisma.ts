import { resolve, join } from 'path'
import { existsSync } from 'fs'
import { isUnderSafeRoot } from '../utils/path-guard'
import { executarPrograma, ambientePadrao } from '../exec/executar-programa'

/**
 * Achado emergencial em 11/09, mesma classe de `git.ts` — mesmo ponto cego do scanner
 * (`safeExec(cmd, cwd)` recebia STRING montada pelo chamador, uma linha de distância da
 * chamada `execSync`). Aqui era mais simples de explorar: `schema` vinha do payload SEM
 * NENHUMA sanitização, e `mode` sem NENHUMA validação de runtime apesar do tipo TypeScript
 * `'deploy' | 'status'` — TypeScript não impede um payload JSON real de trazer qualquer
 * string em `mode`.
 *
 * Provado (isolando a técnica do comportamento lento do `npx` na primeira execução):
 * `<comando> --schema "x" & echo INJETADO & echo ""` executa o `echo` de verdade via
 * `cmd.exe`, o shell que `execSync` usa por padrão no Windows.
 *
 * ## Por que não é `executarPrograma('entrypointJs', 'npx', ...)`
 *
 * Medido em 11/09: `npx.cmd` tem lógica CONDICIONAL — chama `node npm-prefix.js` e troca de
 * `npx-cli.js` se achar um prefixo alternativo. `resolverEntrypointJs()` só extrai o caminho
 * ESTÁTICO do wrapper (de propósito: replicar a semântica condicional do `cmd.exe` seria
 * reescrever o próprio npx). Contra `prisma generate` de verdade, isso resolveu o
 * `npx-cli.js` ERRADO e devolveu um caminho de `.npm-global` em vez de rodar o prisma —
 * sem erro, silenciosamente incorreto, o pior tipo de falha desta casa.
 *
 * A saída: resolver o `prisma` LOCAL do projeto via `require.resolve()` — a própria
 * resolução de módulo do Node, que já entende a estrutura de symlinks do pnpm — e rodar por
 * `node`, estratégia `executavel`. Sem depender do `npx` para achar nada.
 */

function resolverPrismaLocal(cwd: string): string {
  try {
    return require.resolve('prisma/build/index.js', { paths: [cwd] })
  } catch {
    throw new Error(
      `prisma não encontrado como dependência de ${cwd} — instale com "pnpm add -D prisma".`,
    )
  }
}

async function safeExec(args: string[], cwd: string, timeoutMs = 60_000): Promise<string> {
  const prismaJs = resolverPrismaLocal(cwd)
  const r = await executarPrograma('executavel', 'node', [prismaJs, ...args], {
    cwd, env: ambientePadrao(), timeoutMs,
  })
  if (r.code !== 0) {
    const saida = (r.stderr || r.stdout).trim()
    if (saida) return saida
    throw new Error(`prisma ${args.join(' ')} falhou (exit ${r.code})`)
  }
  return r.stdout.trim()
}

function findSchemaPath(projectPath: string): string {
  const candidates = [
    join(projectPath, 'prisma/schema.prisma'),
    join(projectPath, 'apps/api/prisma/schema.prisma'),
    join(projectPath, 'apps/api-v2/prisma/schema.prisma'),
  ]
  const found = candidates.find(existsSync)
  if (!found) throw new Error(`schema.prisma não encontrado em ${projectPath}`)
  return found
}

export async function prismaGenerate(payload: { projectPath: string; schema?: string; dryRun?: boolean }) {
  const cwd = resolve(payload.projectPath)
  if (!isUnderSafeRoot(cwd)) throw new Error(`Caminho não permitido: ${cwd}`)

  const schema = payload.schema ?? findSchemaPath(cwd)
  if (payload.dryRun) return { dryRun: true, schema, wouldRun: `prisma generate --schema ${schema}` }

  const output = await safeExec(['generate', '--schema', schema], cwd)
  return { generated: true, schema, output: output.slice(0, 1000) }
}

/** As duas únicas formas válidas — verificado em RUNTIME, não só no tipo do TypeScript. */
const MODOS_DE_MIGRACAO = new Set(['deploy', 'status'])

export async function prismaMigrate(payload: {
  projectPath: string
  mode:    'deploy' | 'status'  // dev removido — muito destrutivo, usar run_command com force
  schema?: string
  dryRun?: boolean
}) {
  const cwd = resolve(payload.projectPath)
  if (!isUnderSafeRoot(cwd)) throw new Error(`Caminho não permitido: ${cwd}`)

  // O tipo TypeScript não existe em runtime: um payload JSON real pode trazer qualquer
  // string em `mode`, e essa checagem é o que fecha isso — antes dela não havia validação
  // nenhuma além da esperança de que o chamador respeitasse o tipo.
  if (!MODOS_DE_MIGRACAO.has(payload.mode)) {
    throw new Error(`mode inválido: "${payload.mode}" — use "deploy" ou "status".`)
  }

  const schema = payload.schema ?? findSchemaPath(cwd)

  if (payload.mode === 'status') {
    const output = await safeExec(['migrate', 'status', '--schema', schema], cwd)
    return { status: output }
  }

  if (payload.dryRun) {
    return { dryRun: true, schema, mode: payload.mode, wouldRun: `prisma migrate ${payload.mode}` }
  }

  const output = await safeExec(['migrate', payload.mode, '--schema', schema], cwd, 120_000)
  return { migrated: true, mode: payload.mode, schema, output: output.slice(0, 2000) }
}
