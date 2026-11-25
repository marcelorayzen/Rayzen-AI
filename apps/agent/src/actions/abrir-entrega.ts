import { existsSync } from 'fs'
import { basename, dirname, join, resolve } from 'path'
import { isUnderSafeRoot } from '../utils/path-guard'
import { resolverWorkdir } from '../exec/workdir'
import { executarPrograma } from '../exec/executar-programa'
import { ambienteDePublicacao, branchPublicavel, type Executor } from '../exec/publicar-entrega'
import { openVscode } from './open-vscode'

/**
 * `jarvis:open_delivery` — "abrir na minha máquina" do cartão de entrega (item 7.2a, fatia D).
 *
 * ── Worktree persistente, nunca checkout na cópia de trabalho ────────────────
 * Decisão de Marcelo (11/11): revisar uma entrega não pode mexer no que ele tem aberto. Um
 * `checkout` no diretório do projeto trocaria o branch debaixo do editor e arrastaria WIP; o
 * worktree fica numa pasta irmã (`<projeto>.entregas/<sessão>`), descartável sem afetar nada.
 *
 * ── Só lê do remoto, só cria ─────────────────────────────────────────────────
 * `fetch` de UM ref explícito para `refs/remotes/origin/<branch>`; `worktree add` numa pasta
 * nova. Nada é apagado, nenhum branch existente é movido. Pasta que já existe só é reaproveitada
 * quando o próprio git confirma que ela É o worktree dessa entrega — senão, recusa: abrir "a
 * entrega" numa pasta com outro conteúdo mostraria o código errado com o rótulo certo.
 *
 * ── Por que não é despachável pelo LLM ───────────────────────────────────────
 * Entra só pelo botão da web (sessão autenticada de Marcelo). Fica fora da lista de ações que o
 * orquestrador oferece ao modelo, como toda ação cujo gatilho é um clique humano.
 */

export interface ResultadoDeAbrirEntrega {
  path: string
  branch: string
  reutilizado: boolean
}

export async function abrirEntrega(
  payload: { projectId?: string; branch?: string },
  dependencias: {
    executar?: Executor
    env?: NodeJS.ProcessEnv
    resolverCheckout?: (projectId: string) => Promise<string | null>
    abrirEditor?: (path: string) => Promise<unknown>
    dentroDaRaizSegura?: (path: string) => boolean
  } = {},
): Promise<ResultadoDeAbrirEntrega> {
  const branch = payload.branch ?? ''
  if (!branchPublicavel(branch)) throw new Error(`só entregas rayzen/<slug> podem ser abertas (recebido: "${branch}")`)
  if (!payload.projectId) throw new Error('projectId é obrigatório — o checkout é resolvido pelo projeto')

  const resolverCheckout = dependencias.resolverCheckout ?? resolverWorkdir
  const checkout = await resolverCheckout(payload.projectId)
  if (!checkout) throw new Error(`o projeto ${payload.projectId} não tem checkout resolvível nesta máquina`)

  const dir = resolve(join(dirname(checkout), `${basename(checkout)}.entregas`, branch.replace(/^rayzen\//, '')))
  const dentroDaRaizSegura = dependencias.dentroDaRaizSegura ?? isUnderSafeRoot
  if (!dentroDaRaizSegura(dir)) throw new Error(`pasta da entrega fora das raízes seguras: ${dir}`)

  const executar = dependencias.executar
    ?? ((programa, args, opts) => executarPrograma('executavel', programa, args, opts))
  const env = dependencias.env ?? ambienteDePublicacao()
  const git = async (cwd: string, args: readonly string[], timeoutMs = 30_000) => {
    const r = await executar('git', args, { cwd, env, timeoutMs })
    return { ok: r.code === 0 && !r.timedOut, saida: r.stdout.trim(), erro: r.stderr.trim() }
  }
  const abrirEditor = dependencias.abrirEditor ?? ((path: string) => openVscode({ path }))

  if (existsSync(dir)) {
    const head = await git(dir, ['rev-parse', '--abbrev-ref', 'HEAD'])
    if (!head.ok || head.saida !== branch) {
      throw new Error(`a pasta ${dir} existe e não é o worktree de ${branch} — nada foi alterado`)
    }
    await abrirEditor(dir)
    return { path: dir, branch, reutilizado: true }
  }

  const local = await git(checkout, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`])
  let adicionado
  if (local.ok) {
    // A sessão rodou nesta máquina: o branch local É a entrega.
    adicionado = await git(checkout, ['worktree', 'add', dir, branch], 60_000)
  } else {
    const fetch = await git(checkout, ['fetch', 'origin', `refs/heads/${branch}:refs/remotes/origin/${branch}`], 120_000)
    if (!fetch.ok) throw new Error(`não consegui buscar ${branch} no remoto: ${fetch.erro.slice(-200)}`)
    adicionado = await git(checkout, ['worktree', 'add', '--track', '-b', branch, dir, `origin/${branch}`], 60_000)
  }
  if (!adicionado.ok) throw new Error(`git worktree add falhou: ${adicionado.erro.slice(-300)}`)

  await abrirEditor(dir)
  return { path: dir, branch, reutilizado: false }
}
