import { execSync } from 'child_process'
import { resolve } from 'path'
import { isUnderSafeRoot } from '../utils/path-guard'

// Comandos permitidos — adicione aqui para expandir
const ALLOWED_COMMANDS: Record<string, string> = {
  'pnpm test': 'pnpm test',
  'pnpm build': 'pnpm build',
  'pnpm lint': 'pnpm lint',
  'pnpm typecheck': 'pnpm typecheck',
  'pnpm install': 'pnpm install',
  'npm test': 'npm test',
  'npm build': 'npm run build',
  'npm install': 'npm install',
  'pytest': 'pytest',
  'python test': 'python -m pytest',
  'docker ps': 'docker ps',
  'docker compose ps': 'docker compose ps',
  'git status': 'git status',
  'git log': 'git log --oneline -10',
  'ls': 'dir',
}

export async function runCommand(payload: { command: string; path?: string }): Promise<{ output: string; command: string }> {
  const key = Object.keys(ALLOWED_COMMANDS).find((k) =>
    payload.command.toLowerCase().includes(k),
  )
  if (!key) {
    throw new Error(`Comando não permitido: "${payload.command}". Permitidos: ${Object.keys(ALLOWED_COMMANDS).join(', ')}`)
  }

  let cwd: string | undefined
  if (payload.path) {
    const resolved = resolve(payload.path)
    if (!isUnderSafeRoot(resolved)) {
      throw new Error(`Caminho não permitido: ${resolved}`)
    }
    cwd = resolved
  }

  const cmd = ALLOWED_COMMANDS[key]
  const output = execSync(cmd, { encoding: 'utf-8', cwd, timeout: 60000 })
  return { command: cmd, output: output.slice(0, 3000) }
}
