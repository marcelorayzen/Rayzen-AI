import { execSync } from 'child_process'
import { resolve, join } from 'path'
import { existsSync } from 'fs'
import { isUnderSafeRoot } from '../utils/path-guard'

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

function safeExec(cmd: string, cwd: string, timeout = 60_000): string {
  try {
    return execSync(cmd, { encoding: 'utf-8', cwd, timeout, stdio: ['pipe', 'pipe', 'pipe'] }).trim()
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string }
    const out = ((e.stdout ?? '') + '\n' + (e.stderr ?? '')).trim()
    if (out) return out
    throw err
  }
}

export async function prismaGenerate(payload: { projectPath: string; schema?: string; dryRun?: boolean }) {
  const cwd = resolve(payload.projectPath)
  if (!isUnderSafeRoot(cwd)) throw new Error(`Caminho não permitido: ${cwd}`)

  const schema = payload.schema ?? findSchemaPath(cwd)
  if (payload.dryRun) return { dryRun: true, schema, wouldRun: `prisma generate --schema ${schema}` }

  const output = safeExec(`npx prisma generate --schema "${schema}"`, cwd)
  return { generated: true, schema, output: output.slice(0, 1000) }
}

export async function prismaMigrate(payload: {
  projectPath: string
  mode:    'deploy' | 'status'  // dev removido — muito destrutivo, usar run_command com force
  schema?: string
  dryRun?: boolean
}) {
  const cwd = resolve(payload.projectPath)
  if (!isUnderSafeRoot(cwd)) throw new Error(`Caminho não permitido: ${cwd}`)

  const schema = payload.schema ?? findSchemaPath(cwd)

  if (payload.mode === 'status') {
    const output = safeExec(`npx prisma migrate status --schema "${schema}"`, cwd)
    return { status: output }
  }

  if (payload.dryRun) {
    return { dryRun: true, schema, mode: payload.mode, wouldRun: `prisma migrate ${payload.mode}` }
  }

  const output = safeExec(`npx prisma migrate ${payload.mode} --schema "${schema}"`, cwd, 120_000)
  return { migrated: true, mode: payload.mode, schema, output: output.slice(0, 2000) }
}
