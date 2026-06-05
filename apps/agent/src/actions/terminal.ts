import { execSync } from 'child_process'
import { resolve } from 'path'
import { isUnderSafeRoot } from '../utils/path-guard'

// ── Padrões BLOQUEADOS — sempre rejeitados independente do contexto ──────────
const BLOCKED_PATTERNS = [
  /rm\s+-rf?\s+\//, /rm\s+-rf?\s+~/, /rm\s+-rf?\s+\*/,
  /format\s+[a-z]:/i, /del\s+\/[sf]/i,
  /curl\s+.*\|\s*(sh|bash|zsh)/,
  /wget\s+.*\|\s*(sh|bash|zsh)/,
  /:\(\)\s*\{/, /fork\s*bomb/i,
  />\s*\/dev\/sd/, /dd\s+if=.*of=\/dev/,
  /sudo\s+rm/, /sudo\s+chmod\s+777/,
  /shutdown/, /reboot/, /halt/,
  /passwd/, /useradd/, /userdel/,
  /iptables/, /ufw\s+(disable|delete)/,
  /DROP\s+DATABASE/i, /DROP\s+TABLE/i,
  /git\s+push\s+.*--force\s+origin\/(main|master)/,
]

interface AllowRule {
  pattern: RegExp
  risk:    'none' | 'low' | 'medium' | 'high'
  timeout: number
  label:   string
}

const ALLOW_RULES: AllowRule[] = [
  // Git — leitura
  { pattern: /^(git\s+status|git\s+log|git\s+diff|git\s+branch|git\s+show)/,      risk: 'none',   timeout: 15_000,  label: 'git-read'      },
  { pattern: /^git\s+stash(\s+(list|show|pop|apply))?/,                             risk: 'low',    timeout: 15_000,  label: 'git-stash'     },
  { pattern: /^git\s+pull(\s+--rebase)?(\s+origin\s+\S+)?$/,                       risk: 'medium', timeout: 30_000,  label: 'git-pull'      },
  { pattern: /^git\s+push(\s+origin\s+\S+)?$/,                                     risk: 'medium', timeout: 30_000,  label: 'git-push'      },
  { pattern: /^git\s+checkout(\s+-b)?\s+\S+$/,                                     risk: 'low',    timeout: 15_000,  label: 'git-checkout'  },
  { pattern: /^git\s+merge\s+\S+$/,                                                 risk: 'medium', timeout: 15_000,  label: 'git-merge'     },

  // pnpm / npm
  { pattern: /^pnpm\s+(typecheck|lint|format|build|test|test:cov|test:e2e)/,        risk: 'medium', timeout: 180_000, label: 'pnpm-scripts'  },
  { pattern: /^pnpm\s+--filter\s+\S+\s+(typecheck|lint|build|test|start|dev)/,     risk: 'medium', timeout: 180_000, label: 'pnpm-filter'   },
  { pattern: /^pnpm\s+(--filter\s+\S+\s+)?db:(generate|migrate|studio|push)/,      risk: 'high',   timeout: 60_000,  label: 'pnpm-db'       },
  { pattern: /^pnpm\s+(install|add|remove)\b/,                                      risk: 'high',   timeout: 300_000, label: 'pnpm-install'  },
  { pattern: /^npm\s+(test|run\s+\S+|build|install)\b/,                             risk: 'medium', timeout: 180_000, label: 'npm-scripts'   },

  // Prisma direto
  { pattern: /^(npx\s+)?prisma\s+(generate|validate|format)/,                      risk: 'low',    timeout: 60_000,  label: 'prisma-gen'    },
  { pattern: /^(npx\s+)?prisma\s+(migrate\s+(dev|deploy|reset|status)|db\s+push)/, risk: 'high',   timeout: 60_000,  label: 'prisma-migrate'},
  { pattern: /^(npx\s+)?prisma\s+studio/,                                           risk: 'low',    timeout: 10_000,  label: 'prisma-studio' },

  // Node / TypeScript
  { pattern: /^(node|npx\s+tsc|tsc)\s+/,                                           risk: 'medium', timeout: 60_000,  label: 'node-tsc'      },
  { pattern: /^npx\s+\S+/,                                                          risk: 'medium', timeout: 120_000, label: 'npx'           },

  // Docker
  { pattern: /^docker\s+(ps|images|stats|logs|inspect)\b/,                         risk: 'none',   timeout: 15_000,  label: 'docker-read'   },
  { pattern: /^docker\s+compose\s+(ps|logs|config)\b/,                             risk: 'none',   timeout: 15_000,  label: 'docker-read'   },
  { pattern: /^docker\s+compose\s+(up|down|restart|build|start|stop)\b/,           risk: 'high',   timeout: 300_000, label: 'docker-compose'},
  { pattern: /^docker\s+(start|stop|restart)\s+\S+$/,                              risk: 'medium', timeout: 30_000,  label: 'docker-ctrl'   },

  // Leitura de filesystem
  { pattern: /^(ls|dir|cat|head|tail|grep|find|wc)\b/,                             risk: 'none',   timeout: 15_000,  label: 'fs-read'       },
  { pattern: /^(pwd|echo|env|printenv)\b/,                                          risk: 'none',   timeout: 5_000,   label: 'shell-read'    },

  // Python
  { pattern: /^(python3?|pytest|pip\s+install)\s+/,                                risk: 'medium', timeout: 180_000, label: 'python'        },

  // SSH deploy
  { pattern: /^ssh\s+-i\s+\S+\s+\S+\s+"(cd\s+[^;]+;\s*)?(git\s+pull|docker\s+compose)/, risk: 'high', timeout: 120_000, label: 'ssh-deploy' },
]

function isBlocked(command: string): string | null {
  for (const p of BLOCKED_PATTERNS) {
    if (p.test(command)) return `Comando bloqueado: ${p.source}`
  }
  return null
}

function matchRule(command: string): AllowRule | null {
  const trimmed = command.trim()
  for (const rule of ALLOW_RULES) {
    if (rule.pattern.test(trimmed)) return rule
  }
  return null
}

export interface RunCommandResult {
  command: string
  output:  string
  dryRun:  boolean
  risk:    string
  label:   string
  skipped: boolean
  reason?: string
}

export async function runCommand(payload: {
  command: string
  path?:   string
  dryRun?: boolean
  force?:  boolean
}): Promise<RunCommandResult> {
  const command = payload.command.trim()

  const blocked = isBlocked(command)
  if (blocked) throw new Error(blocked)

  const rule = matchRule(command)
  if (!rule) {
    throw new Error(
      `Comando não reconhecido: "${command}". Adicione um padrão em ALLOW_RULES se legítimo.`
    )
  }

  if (rule.risk === 'high' && !payload.dryRun && !payload.force) {
    return {
      command, output: `[BLOQUEADO] Risco ${rule.risk} — requer dryRun:true primeiro, depois force:true para executar.`,
      dryRun: true, risk: rule.risk, label: rule.label, skipped: true,
      reason: 'high-risk requires explicit approval',
    }
  }

  let cwd: string | undefined
  if (payload.path) {
    const resolved = resolve(payload.path)
    if (!isUnderSafeRoot(resolved)) throw new Error(`Caminho não permitido: ${resolved}`)
    cwd = resolved
  }

  if (payload.dryRun) {
    return {
      command, output: `[dryRun] Executaria: ${command}${cwd ? ` em ${cwd}` : ''} (timeout: ${rule.timeout / 1000}s, risco: ${rule.risk})`,
      dryRun: true, risk: rule.risk, label: rule.label, skipped: false,
    }
  }

  let output: string
  try {
    output = execSync(command, {
      encoding: 'utf-8', cwd, timeout: rule.timeout,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; message?: string }
    output = ((e.stdout ?? '') + '\n' + (e.stderr ?? '')).trim()
    if (!output) throw new Error(`Falha: ${e.message ?? String(err)}`)
  }

  return { command, output: output.slice(0, 4000), dryRun: false, risk: rule.risk, label: rule.label, skipped: false }
}
