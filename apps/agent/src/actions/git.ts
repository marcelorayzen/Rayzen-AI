import { resolve } from 'path'
import { existsSync } from 'fs'
import { isUnderSafeRoot } from '../utils/path-guard'
import { executarPrograma, ambientePadrao } from '../exec/executar-programa'

/**
 * Migração urgente, fora da ordem do plano — achada ao desenhar a Fase 2, não pela
 * varredura da Fase 0. `docs/exec-paths.md` nunca viu este arquivo como risco porque o
 * scanner só olha a MESMA LINHA da chamada `execSync` — aqui a interpolação acontecia numa
 * template string construída no CHAMADOR e passada como parâmetro para `safeExec(cmd, cwd)`,
 * uma linha inteira de distância. É o mesmo ponto cego que só apareceu de novo em
 * `outlook.ts sendEmail` (Fase 1) — texto perigoso não precisa estar na linha do exec para
 * ser perigoso.
 *
 * Três vetores confirmados AO VIVO em 11/09, contra um repositório de teste isolado (nunca
 * tocou rede nem apagou nada real — `cmd.exe`, não bash/PowerShell, é o shell que
 * `execSync` invoca por padrão no Windows, e os vetores certos são os DELE):
 *
 * | função | campo | vetor | prova |
 * |---|---|---|---|
 * | `gitDiff` | `file` | sem sanitização, fecha a aspa e encadeia com `&` | `file: 'x.txt" & echo INJETADO & echo "'` imprimiu `INJETADO` de verdade |
 * | `gitPush` | `branch` | sem aspa NENHUMA — `&`/`|` funcionam direto | mesma classe, ainda mais simples que o de cima |
 * | `gitCommit` | `message` | `%VAR%` do cmd.exe expande DENTRO de aspas duplas | `message: 'fix: %SEGREDO%'` gravou o VALOR real no commit |
 *
 * O terceiro é o mais grave: não é execução, é **exfiltração de segredo para o histórico do
 * git** — `%AGENT_TOKEN%` na mensagem de commit grava o token em claro, permanente, e um
 * `git push` na sequência publica.
 *
 * `shell: false` (via `executarPrograma`) mata os três de uma vez: sem shell, não há `&`
 * para separar comando nem `%VAR%` para expandir — o valor chega ao `git.exe` como um
 * argv exatamente como foi escrito, nunca reinterpretado.
 *
 * Isso NÃO fecha sozinho um vetor diferente: **injeção de opção**. Um `branch` como
 * `--upload-pack=/tmp/evil` continua sendo argv válido, só que interpretado pelo PRÓPRIO
 * `git` como flag, não como ref. `shell:false` garante que o valor chega intacto — não
 * garante que o programa que o recebe o trata como dado. Por isso `--` antes de pathspec
 * (`gitDiff`/`gitAdd`, convenção do próprio git: "--" encerra o parsing de opções) e
 * `rejeitarFlag` para valores que não têm essa convenção (branch de push/checkout).
 */

async function safeExec(args: string[], cwd: string): Promise<string> {
  const r = await executarPrograma('executavel', 'git', args, {
    cwd, env: ambientePadrao(), timeoutMs: 15_000,
  })
  if (r.code !== 0) {
    throw new Error(`git ${args.join(' ')} falhou (exit ${r.code}): ${(r.stderr || r.stdout).trim()}`)
  }
  return r.stdout.trim()
}

function validatePath(path: string): string {
  const resolved = resolve(path)
  if (!isUnderSafeRoot(resolved)) throw new Error(`Caminho não permitido: ${resolved}`)
  if (!existsSync(resolved)) throw new Error(`Pasta não encontrada: ${resolved}`)
  return resolved
}

/**
 * `shell:false` garante que o valor chega intacto ao git — não garante que o git o trate
 * como dado em vez de opção. Um ref/branch que começa com `-` seria lido como flag
 * (`--upload-pack=...`, `--exec=...`). Refs de verdade nunca começam com `-`; rejeitar é
 * mais seguro que tentar adivinhar quais prefixos são "opções conhecidas" do git.
 */
function rejeitarFlag(valor: string, campo: string): string {
  if (valor.startsWith('-')) {
    throw new Error(`${campo} não pode começar com "-" — seria lido como opção do git, não como valor.`)
  }
  return valor
}

export async function gitStatus(payload: { path: string }) {
  const cwd = validatePath(payload.path)
  const output = await safeExec(['status', '--short'], cwd)
  const branch = await safeExec(['branch', '--show-current'], cwd)
  const lines = output ? output.split('\n').map((l) => l.trim()) : []
  return { branch, changed: lines.length, files: lines }
}

export async function gitLog(payload: { path: string; limit?: number }) {
  const cwd = validatePath(payload.path)
  const limit = Math.min(payload.limit ?? 10, 30)
  const output = await safeExec(['log', '--oneline', `-${limit}`], cwd)
  const commits = output.split('\n').filter(Boolean).map((line) => {
    const [hash, ...rest] = line.split(' ')
    return { hash, message: rest.join(' ') }
  })
  return { commits }
}

export async function gitBranch(payload: { path: string; name?: string; dryRun?: boolean }) {
  const cwd = validatePath(payload.path)
  if (!payload.name) {
    const output = await safeExec(['branch'], cwd)
    const branches = output.split('\n').map((b) => b.trim().replace(/^\* /, '')).filter(Boolean)
    const current = await safeExec(['branch', '--show-current'], cwd)
    return { branches, current }
  }
  // A allowlist tira metacaractere de shell, mas `-` sobrevive nela (nomes de branch usam
  // `-` legitimamente) — por isso o `rejeitarFlag` roda DEPOIS, contra o resultado já
  // sanitizado: `--upload-pack=x` só perde o `=` na allowlist e continua começando com `--`.
  const name = rejeitarFlag(payload.name.replace(/[^a-zA-Z0-9_\-/]/g, '-'), 'nome do branch')
  if (payload.dryRun) return { dryRun: true, wouldCreate: name }
  await safeExec(['checkout', '-b', name], cwd)
  return { created: name }
}

export async function gitDiff(payload: { path: string; staged?: boolean; file?: string }) {
  const cwd = validatePath(payload.path)
  const args = ['diff']
  if (payload.staged) args.push('--staged')
  // `--` encerra o parsing de opções do git: tudo depois é pathspec, nunca flag, qualquer
  // que seja o prefixo do valor. É a convenção do próprio git para este caso exato.
  if (payload.file) args.push('--', payload.file)
  const output = await safeExec(args, cwd)
  return { diff: output.slice(0, 8000), truncated: output.length > 8000 }
}

export async function gitPull(payload: { path: string; rebase?: boolean; dryRun?: boolean }) {
  const cwd = validatePath(payload.path)
  if (payload.dryRun) {
    try {
      const behind = await safeExec(['rev-list', 'HEAD..@{u}', '--count'], cwd)
      return { dryRun: true, commitsBehind: parseInt(behind) || 0 }
    } catch { return { dryRun: true, commitsBehind: 0 } }
  }
  const args = ['pull']
  if (payload.rebase) args.push('--rebase')
  const output = await safeExec(args, cwd)
  return { pulled: true, output }
}

export async function gitPush(payload: { path: string; branch?: string; dryRun?: boolean }) {
  const cwd = validatePath(payload.path)
  const current = await safeExec(['branch', '--show-current'], cwd)
  if (payload.dryRun) {
    try {
      const ahead = await safeExec(['rev-list', '@{u}..HEAD', '--count'], cwd)
      return { dryRun: true, branch: current, commitsAhead: parseInt(ahead) || 0 }
    } catch { return { dryRun: true, branch: current, commitsAhead: 0 } }
  }
  const target = rejeitarFlag(payload.branch ?? current, 'branch de destino')
  await safeExec(['push', 'origin', target], cwd)
  return { pushed: true, branch: target }
}

export async function gitAdd(payload: { path: string; files: string[]; dryRun?: boolean }) {
  const cwd = validatePath(payload.path)
  const safe = payload.files
    .filter((f) => !f.includes('../') && !f.startsWith('/'))
    .slice(0, 50)
  if (!safe.length) throw new Error('Nenhum arquivo válido para adicionar')
  if (payload.dryRun) return { dryRun: true, files: safe }
  // `--` antes dos pathspecs: mesma convenção de gitDiff.
  await safeExec(['add', '--', ...safe], cwd)
  return { added: true, files: safe }
}

export async function gitCommit(payload: { path: string; message: string; files?: string[]; dryRun?: boolean }) {
  const cwd = validatePath(payload.path)
  // O `.replace(/"/g, "'")` de antes existia para um shell que não existe mais neste
  // caminho — sem shell, aspa dupla é só um caractere no argv, não um delimitador para
  // escapar. Mantém só o truncamento, que é limite de exibição, não defesa.
  const message = payload.message.slice(0, 200)

  if (payload.files?.length) {
    const safe = payload.files.filter((f) => !f.includes('../')).slice(0, 50)
    await safeExec(['add', '--', ...safe], cwd)
  } else {
    await safeExec(['add', '-A'], cwd)
  }

  if (payload.dryRun) {
    const status = await safeExec(['status', '--short'], cwd)
    return { dryRun: true, message, files: status.split('\n').filter(Boolean) }
  }
  // `message` pode começar com `-` (ex.: "-1 hora de trabalho") sem ser opção: `-m` já
  // consome exatamente o próximo argv como valor, então não há ambiguidade a resolver aqui
  // como há em `push`/`checkout`, onde o valor ocupa uma posição que o git também aceitaria
  // como início de outra flag.
  await safeExec(['commit', '-m', message], cwd)
  return { committed: true, message }
}
