import { execSync } from 'child_process'
import { resolve } from 'path'
import { isUnderSafeRoot } from '../utils/path-guard'

interface CommandMeta {
  cmd: string
  timeout: number
  risk: 'low' | 'medium' | 'high'
}

// Comandos permitidos com timeout por categoria e nível de risco
const ALLOWED_COMMANDS: Record<string, CommandMeta> = {
  // Leitura/diagnóstico — baixo risco
  'git status':       { cmd: 'git status',          timeout: 10_000, risk: 'low' },
  'git log':          { cmd: 'git log --oneline -10', timeout: 10_000, risk: 'low' },
  'docker ps':        { cmd: 'docker ps',            timeout: 10_000, risk: 'low' },
  'docker compose ps':{ cmd: 'docker compose ps',    timeout: 10_000, risk: 'low' },
  'ls':               { cmd: 'dir',                  timeout: 10_000, risk: 'low' },

  // Testes e build — risco médio, timeout estendido
  'pnpm test':        { cmd: 'pnpm test',            timeout: 120_000, risk: 'medium' },
  'pnpm build':       { cmd: 'pnpm build',           timeout: 120_000, risk: 'medium' },
  'pnpm lint':        { cmd: 'pnpm lint',            timeout: 60_000,  risk: 'medium' },
  'pnpm typecheck':   { cmd: 'pnpm typecheck',       timeout: 60_000,  risk: 'medium' },
  'npm test':         { cmd: 'npm test',             timeout: 120_000, risk: 'medium' },
  'npm build':        { cmd: 'npm run build',        timeout: 120_000, risk: 'medium' },
  'pytest':           { cmd: 'pytest',               timeout: 120_000, risk: 'medium' },
  'python test':      { cmd: 'python -m pytest',     timeout: 120_000, risk: 'medium' },

  // Instalação — alto risco (modifica node_modules)
  'pnpm install':     { cmd: 'pnpm install',         timeout: 180_000, risk: 'high' },
  'npm install':      { cmd: 'npm install',          timeout: 180_000, risk: 'high' },
}

export interface RunCommandResult {
  command: string
  output: string
  dryRun: boolean
  risk: 'low' | 'medium' | 'high'
  skipped?: boolean
  reason?: string
}

export async function runCommand(payload: {
  command: string
  path?: string
  dryRun?: boolean
}): Promise<RunCommandResult> {
  const key = Object.keys(ALLOWED_COMMANDS).find((k) =>
    payload.command.toLowerCase().includes(k),
  )

  if (!key) {
    throw new Error(
      `Comando não permitido: "${payload.command}". Permitidos: ${Object.keys(ALLOWED_COMMANDS).join(', ')}`,
    )
  }

  const meta = ALLOWED_COMMANDS[key]

  let cwd: string | undefined
  if (payload.path) {
    const resolved = resolve(payload.path)
    if (!isUnderSafeRoot(resolved)) {
      throw new Error(`Caminho não permitido: ${resolved}`)
    }
    cwd = resolved
  }

  // dryRun: descreve o que seria executado sem executar
  if (payload.dryRun) {
    return {
      command: meta.cmd,
      output: `[dryRun] Executaria: ${meta.cmd}${cwd ? ` em ${cwd}` : ''} (timeout: ${meta.timeout / 1000}s, risco: ${meta.risk})`,
      dryRun: true,
      risk: meta.risk,
    }
  }

  const output = execSync(meta.cmd, {
    encoding: 'utf-8',
    cwd,
    timeout: meta.timeout,
  })

  return {
    command: meta.cmd,
    output: output.slice(0, 3000),
    dryRun: false,
    risk: meta.risk,
  }
}
