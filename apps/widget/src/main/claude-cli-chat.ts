import { spawn, execSync } from 'child_process'
import { existsSync } from 'fs'
import path from 'path'

export interface ClaudeCliResult {
  ok:     boolean
  reply:  string
  error?: string
}

export interface ClaudeContext {
  projectName:    string
  activeMissions: { title: string; objective: string; status: string }[]
}

// Caminhos conhecidos onde o claude.cmd pode estar instalado (Windows)
const KNOWN_PATHS = [
  process.env.CLAUDE_CLI_PATH,
  path.join(process.env.APPDATA ?? '', '../Local/pnpm/claude.cmd'),
  path.join(process.env.USERPROFILE ?? '', '.npm-global/claude.cmd'),
  path.join(process.env.USERPROFILE ?? '', 'AppData/Roaming/npm/claude.cmd'),
  path.join(process.env.USERPROFILE ?? '', '.local/bin/claude'),
  '/usr/local/bin/claude',
].filter(Boolean) as string[]

function resolveClaude(): string {
  // 1. Verificar caminhos conhecidos
  for (const p of KNOWN_PATHS) {
    if (existsSync(p)) return p
  }
  // 2. Tentar where.exe (Windows) para buscar no PATH do sistema
  try {
    const found = execSync('where claude', { encoding: 'utf8', timeout: 3000 }).trim().split('\n')[0]
    if (found) return found.trim()
  } catch { /* não encontrado via where */ }
  // 3. Fallback — tenta só "claude" e espera que o shell resolva
  return process.platform === 'win32' ? 'claude.cmd' : 'claude'
}

function buildPrompt(message: string, ctx?: ClaudeContext): string {
  if (!ctx) return message

  const missions = ctx.activeMissions
    .filter((m) => m.status === 'active' || m.status === 'pending')
    .slice(0, 5)
    .map((m) => `  - [${m.status}] ${m.title}: ${m.objective}`)
    .join('\n')

  const context = [
    `Projeto ativo: ${ctx.projectName}`,
    missions ? `Missões abertas:\n${missions}` : null,
  ]
    .filter(Boolean)
    .join('\n')

  return `${context}\n\n${message}`
}

export class ClaudeCliChat {
  private static claudePath: string | null = null

  static chat(message: string, ctx?: ClaudeContext, timeoutMs = 120_000): Promise<ClaudeCliResult> {
    return new Promise((resolve) => {
      if (!ClaudeCliChat.claudePath) {
        ClaudeCliChat.claudePath = resolveClaude()
      }

      const prompt = buildPrompt(message, ctx)
      const claudePath = ClaudeCliChat.claudePath

      // Passa o prompt via stdin — evita problemas de escaping de aspas/newlines
      const child = spawn(claudePath, ['--print'], {
        stdio:       ['pipe', 'pipe', 'pipe'],
        shell:       true,
        windowsHide: true,
        env:         { ...process.env },
      })

      let stdout = ''
      let stderr = ''

      child.stdout.on('data', (d: Buffer) => { stdout += d.toString() })
      child.stderr.on('data', (d: Buffer) => { stderr += d.toString() })

      // Escreve o prompt no stdin e fecha
      child.stdin.write(prompt, 'utf8')
      child.stdin.end()

      const timer = setTimeout(() => {
        child.kill()
        resolve({ ok: false, reply: '', error: 'Timeout — claude demorou mais de 2min' })
      }, timeoutMs)

      child.on('close', (code) => {
        clearTimeout(timer)
        const reply = stdout.trim()
        if (reply) {
          resolve({ ok: true, reply })
        } else {
          const errMsg = stderr.trim() || `claude saiu com código ${code}`
          resolve({ ok: false, reply: '', error: errMsg })
        }
      })

      child.on('error', (err) => {
        clearTimeout(timer)
        resolve({ ok: false, reply: '', error: `Não foi possível iniciar o claude: ${err.message}` })
      })
    })
  }
}
