import { execFileSync } from 'child_process'
import { existsSync, readFileSync } from 'fs'
import { dirname, join } from 'path'

/**
 * Qual executável roda a sessão supervisionada no regime LOCAL — item 7.2a (12/11).
 *
 * ── O defeito que isto fecha ─────────────────────────────────────────────────
 * `runClaude` fazia `spawn('claude', …)` sem shell. No Windows o CLI instalado por npm é
 * `claude.cmd`, um wrapper; `spawn` sem shell não executa `.cmd`, e a primeira sessão real do
 * regime local morreu com `spawn claude ENOENT`. As provas anteriores injetavam o executor — o
 * caminho real nunca tinha rodado nesta máquina.
 *
 * ── Por que ler o wrapper, e não `shell: true` ───────────────────────────────
 * Mesma decisão de `resolverEntrypointJs()` para `code.cmd`: com shell, o prompt (texto livre
 * vindo de quem pediu) passaria pelo `cmd.exe`, que expande `%VAR%` até dentro de aspas — o
 * vetor que esta casa já mediu em `git.ts`. O wrapper do Claude chama um binário nativo
 * (`…\@anthropic-ai\claude-code\bin\claude.exe`), então basta achá-lo e executar direto.
 *
 * Ordem: `RAYZEN_CLAUDE_BIN` explícito → `.exe` no PATH → binário apontado pelo `.cmd` → `claude`
 * (fora do Windows, `spawn('claude')` funciona). Nunca lança: devolve o melhor candidato, e o
 * `spawn` falha alto se ele não existir.
 */
export function resolverExecutavelClaude(dependencias: {
  plataforma?: NodeJS.Platform
  env?: NodeJS.ProcessEnv
  onde?: (nome: string) => string[]
  existe?: (caminho: string) => boolean
  ler?: (caminho: string) => string
} = {}): string {
  const plataforma = dependencias.plataforma ?? process.platform
  const env = dependencias.env ?? process.env
  const existe = dependencias.existe ?? existsSync
  const ler = dependencias.ler ?? ((c: string) => readFileSync(c, 'utf8'))
  const onde = dependencias.onde ?? ((nome: string) => {
    try {
      return execFileSync('where.exe', [nome], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
        .split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
    } catch {
      return [] // `where.exe` sai 1 quando não acha nada
    }
  })

  const explicito = env.RAYZEN_CLAUDE_BIN?.trim()
  if (explicito && existe(explicito)) return explicito
  if (plataforma !== 'win32') return 'claude'

  const candidatos = onde('claude')
  const exe = candidatos.find((c) => /\.exe$/i.test(c))
  if (exe) return exe

  for (const wrapper of candidatos.filter((c) => /\.cmd$/i.test(c))) {
    let texto: string
    try { texto = ler(wrapper) } catch { continue }
    // "%dp0%\node_modules\@anthropic-ai\claude-code\bin\claude.exe"
    const m = /"%dp0%\\?([^"%]+?\.exe)"/i.exec(texto)
    if (!m) continue
    const alvo = join(dirname(wrapper), m[1])
    if (existe(alvo)) return alvo
  }
  return 'claude'
}
