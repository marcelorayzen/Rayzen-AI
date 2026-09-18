import { executarPrograma, ambientePadrao } from '../exec/executar-programa'

/**
 * Primeira migração da Fase 1 de `docs/plano-execucao-tipada.md`.
 *
 * Antes: `execSync(\`docker start ${name}\`)` — string montada. A Fase 0 já havia avaliado isto
 * como "seguro" (a allowlist `[^a-zA-Z0-9_\-]` no nome do container e o `tail` clampado fecham
 * o vetor conhecido), mas seguro **hoje** não é o mesmo que impossível de errar amanhã: era
 * exatamente o padrão que o `clipboard_write`/`notify` também tinham antes de a aspa dupla
 * provar o contrário. Migrado para `executarPrograma('executavel', ...)` — `shell: false`,
 * argumentos como vetor — em vez de manter uma segunda allowlist paralela para sempre revisar.
 *
 * `docker` opera sobre o daemon, não sobre um diretório de projeto: `cwd` não importa para ele,
 * então o valor aqui é só o que o SO exige para existir.
 */

const OPCOES = { cwd: process.cwd(), env: ambientePadrao(), timeoutMs: 15_000 } as const

async function docker(args: readonly string[]) {
  const r = await executarPrograma('executavel', 'docker', args, OPCOES)
  if (r.code !== 0) {
    throw new Error(`docker ${args.join(' ')} falhou (exit ${r.code}): ${r.stderr || r.stdout}`.trim())
  }
  return r.stdout.trim()
}

export async function dockerPs() {
  const output = await docker(['ps', '--format', '{{.Names}}|{{.Status}}|{{.Image}}|{{.Ports}}'])
  const containers = output.split('\n').filter(Boolean).map((line) => {
    const [name, status, image, ports] = line.split('|')
    return { name, status, image, ports }
  })
  return { containers, total: containers.length }
}

export async function dockerStart(payload: { name: string; dryRun?: boolean }) {
  const name = payload.name.replace(/[^a-zA-Z0-9_\-]/g, '')
  if (!name) throw new Error('Nome do container inválido')
  if (payload.dryRun) return { dryRun: true, wouldStart: name }
  await docker(['start', name])
  return { started: name }
}

export async function dockerStop(payload: { name: string; dryRun?: boolean }) {
  const name = payload.name.replace(/[^a-zA-Z0-9_\-]/g, '')
  if (!name) throw new Error('Nome do container inválido')
  if (payload.dryRun) return { dryRun: true, wouldStop: name }
  await docker(['stop', name])
  return { stopped: name }
}

export async function dockerLogs(payload: { name: string; tail?: number }) {
  const name = payload.name.replace(/[^a-zA-Z0-9_\-]/g, '')
  if (!name) throw new Error('Nome do container inválido')
  const tail = Math.min(Math.max(payload.tail ?? 100, 1), 500)
  const output = await docker(['logs', '--tail', String(tail), name])
  return { name, tail, output: output.slice(-12000) }
}
