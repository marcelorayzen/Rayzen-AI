import { executarPrograma, ambientePadrao, type OpcoesDeExecucao, type ResultadoDeExecucao } from './executar-programa'

/**
 * Publica o trabalho de uma sessão como ENTREGA revisável: branch `rayzen/*` no remoto + PR em
 * rascunho. Item 7.2a do backlog (11/11).
 *
 * ── Por que existe ───────────────────────────────────────────────────────────
 * A sessão supervisionada terminava com um branch LOCAL e um bloco de comandos de merge no
 * resumo. Do celular, ou de qualquer lugar que não seja este PC, aquilo não existe. Um PR é o
 * que se abre de qualquer tela: diff, comentários, merge — e o merge continua humano.
 *
 * ── Quem publica, e quem não ─────────────────────────────────────────────────
 * A SESSÃO continua com `Bash(git push:*)` negado: um push entre dois checkpoints publicaria
 * antes de alguém revisar. Quem publica é o processo do agent, DEPOIS de a sessão declarar
 * conclusão, e só quando o envelope aprovado pediu (`publicar: true`).
 *
 * ── As travas, e por que são de código ───────────────────────────────────────
 * - Só `rayzen/<slug>`. `main`/`master` e qualquer outro nome são recusados ANTES de qualquer
 *   comando — o webhook de deploy implanta `refs/heads/main`, e "o chamador nunca passaria
 *   main" é acordo, não mecanismo.
 * - Refspec explícito `refs/heads/X:refs/heads/X`, sem `--force`: um nome ambíguo não vira
 *   outro ref, e histórico remoto nunca é reescrito.
 * - Branch sem commit à frente da base não é entrega: devolve `sem_commits` em vez de abrir um
 *   PR vazio que afirmaria trabalho feito.
 *
 * ── Ambiente: medido, não presumido (11/11) ──────────────────────────────────
 * Com `ambientePadrao()` o `git` autentica (credential manager), mas o `gh` responde "not
 * logged in": a config dele mora em `%APPDATA%\GitHub CLI`. `APPDATA` entra NOMEADA, só aqui.
 * `GIT_TERMINAL_PROMPT=0`/`GCM_INTERACTIVE=never`: sem credencial, falhar em vez de travar
 * esperando senha num processo sem tela.
 *
 * ── PR que falha não desfaz a entrega ────────────────────────────────────────
 * Se o push passou e o `gh` falhou, o branch publicado JÁ é entrega revisável (abre no
 * GitHub); o resultado diz `prErro` em vez de virar falha total — trabalho concluído não vira
 * erro por causa do último degrau, mesma regra do bundle da sessão isolada.
 */

export type Executor = (
  programa: string,
  args: readonly string[],
  opts: OpcoesDeExecucao,
) => Promise<ResultadoDeExecucao>

export interface Entrega {
  readonly branch: string
  readonly base: string
  readonly commit: string
  readonly commitsAFrente: number
  readonly diffstat: string
  readonly remoto: string
  readonly prUrl?: string
  readonly prErro?: string
}

export type ResultadoDaPublicacao =
  | { readonly ok: true; readonly entrega: Entrega }
  | { readonly ok: false; readonly motivo: MotivoDeRecusa; readonly detalhe?: string }

export type MotivoDeRecusa =
  | 'branch_recusado'
  | 'nao_e_repositorio'
  | 'sem_remoto'
  | 'sem_base'
  | 'sem_commits'
  | 'push_falhou'
  /** A pessoa viu o diff e não autorizou publicar (ou não respondeu). Decidido na sessão. */
  | 'publicacao_nao_autorizada'

/** `rayzen/` + slug minúsculo. Nada de `..`, espaço, `:`, `~`, `^` ou prefixo de opção. */
const BRANCH_PUBLICAVEL = /^rayzen\/[a-z0-9][a-z0-9-]{0,62}$/

export function branchPublicavel(branch: string): boolean {
  return BRANCH_PUBLICAVEL.test(branch)
}

export function ambienteDePublicacao(fonte: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env = ambientePadrao(fonte)
  if (fonte.APPDATA !== undefined) env.APPDATA = fonte.APPDATA
  env.GIT_TERMINAL_PROMPT = '0'
  env.GCM_INTERACTIVE = 'never'
  return env
}

const executorPadrao: Executor = (programa, args, opts) =>
  executarPrograma('executavel', programa, args, opts)

/**
 * O repositório tem `origin`? Só lê a config (`remote get-url` não toca a rede).
 *
 * 15/11: publicar sem remoto não é pedido impossível de cumprir pela metade; é entrega local. Todo
 * projeto que o Hub cria nasce sem remoto, e a recusa no preflight transformava a primeira tarefa
 * de código em qualquer projeto novo em "não materializou", sem trabalho nenhum feito.
 */
export async function temRemotoOrigin(
  repo: string,
  dependencias: { executar?: Executor; env?: NodeJS.ProcessEnv } = {},
): Promise<boolean> {
  const executar = dependencias.executar ?? executorPadrao
  try {
    const r = await executar('git', ['remote', 'get-url', 'origin'], {
      cwd: repo, env: dependencias.env ?? ambienteDePublicacao(), timeoutMs: 10_000,
    })
    return r.code === 0 && !r.timedOut && r.stdout.trim().length > 0
  } catch {
    return false
  }
}

export async function publicarEntrega(
  repo: string,
  branch: string,
  pr: { titulo: string; corpo: string },
  dependencias: { executar?: Executor; env?: NodeJS.ProcessEnv; baseRef?: string } = {},
): Promise<ResultadoDaPublicacao> {
  if (!branchPublicavel(branch)) {
    return { ok: false, motivo: 'branch_recusado', detalhe: `só rayzen/<slug> é publicável (recebido: "${branch}")` }
  }

  const executar = dependencias.executar ?? executorPadrao
  const env = dependencias.env ?? ambienteDePublicacao()
  const rodar = (programa: string, args: readonly string[], timeoutMs = 20_000) =>
    executar(programa, args, { cwd: repo, env, timeoutMs })
  const git = async (args: readonly string[], timeoutMs?: number) => {
    const r = await rodar('git', args, timeoutMs)
    return r.code === 0 && !r.timedOut ? r.stdout.trim() : null
  }

  if ((await git(['rev-parse', '--git-dir'])) === null) {
    return { ok: false, motivo: 'nao_e_repositorio' }
  }

  const remoto = await git(['remote', 'get-url', 'origin'])
  if (!remoto) return { ok: false, motivo: 'sem_remoto' }

  // G6, fatia 4: com `baseRef`, o PR vai contra o ramo pedido (a correção de um PR aponta para o
  // ramo dele). Se esse ramo não existe no remoto, recusa — cair para `main` abriria o PR contra o
  // alvo errado sem ninguém notar.
  let base: string
  if (dependencias.baseRef !== undefined) {
    if (!(await git(['rev-parse', '--verify', `refs/remotes/origin/${dependencias.baseRef}`]))) {
      return { ok: false, motivo: 'sem_base', detalhe: `o ramo de base origin/${dependencias.baseRef} não existe no remoto` }
    }
    base = `origin/${dependencias.baseRef}`
  } else {
    base = await baseDoRepositorio(git)
  }
  const commit = await git(['rev-parse', '--verify', `refs/heads/${branch}`])
  if (!commit) return { ok: false, motivo: 'sem_commits', detalhe: `branch ${branch} não existe` }

  const contagem = Number(await git(['rev-list', '--count', `${base}..refs/heads/${branch}`]))
  if (!Number.isFinite(contagem) || contagem < 1) {
    return { ok: false, motivo: 'sem_commits', detalhe: `${branch} não tem commit à frente de ${base}` }
  }
  const diffstat = (await git(['diff', '--shortstat', `${base}...refs/heads/${branch}`])) ?? ''

  const push = await rodar('git', ['push', 'origin', `refs/heads/${branch}:refs/heads/${branch}`], 120_000)
  if (push.code !== 0 || push.timedOut) {
    return {
      ok: false,
      motivo: 'push_falhou',
      detalhe: (push.timedOut ? 'tempo esgotado' : push.stderr.trim()).slice(-300),
    }
  }

  const entrega: Entrega = {
    branch, base: base.replace(/^refs\/heads\//, ''), commit, commitsAFrente: contagem, diffstat, remoto,
  }
  return { ok: true, entrega: { ...entrega, ...(await abrirOuReusarPr(rodar, entrega, pr)) } }
}

/**
 * Base = branch padrão do remoto (`origin/HEAD`), caindo em `main`. A base local pode estar
 * atrás; comparar contra ela inflaria a contagem com commits que já estão no remoto.
 */
async function baseDoRepositorio(git: (args: readonly string[]) => Promise<string | null>): Promise<string> {
  const head = await git(['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD'])
  if (head) return head.replace(/^refs\/remotes\//, '')
  return (await git(['rev-parse', '--verify', 'refs/remotes/origin/main'])) ? 'origin/main' : 'main'
}

/** Reentregar o mesmo branch não abre um segundo PR: o existente é devolvido. */
async function abrirOuReusarPr(
  rodar: (programa: string, args: readonly string[], timeoutMs?: number) => Promise<ResultadoDeExecucao>,
  entrega: Entrega,
  pr: { titulo: string; corpo: string },
): Promise<{ prUrl?: string; prErro?: string }> {
  try {
    const existente = await rodar('gh', ['pr', 'view', entrega.branch, '--json', 'url', '--jq', '.url'])
    if (existente.code === 0 && /^https:\/\//.test(existente.stdout.trim())) {
      return { prUrl: existente.stdout.trim() }
    }
    const baseCurta = entrega.base.replace(/^origin\//, '')
    const criado = await rodar('gh', [
      'pr', 'create', '--draft',
      '--head', entrega.branch, '--base', baseCurta,
      '--title', pr.titulo.slice(0, 200), '--body', pr.corpo.slice(0, 60_000),
    ], 60_000)
    const url = criado.stdout.trim().split(/\r?\n/).find((l) => /^https:\/\//.test(l))
    if (criado.code === 0 && url) return { prUrl: url }
    return { prErro: (criado.timedOut ? 'tempo esgotado' : criado.stderr.trim() || 'gh não devolveu URL').slice(-300) }
  } catch (e) {
    return { prErro: (e instanceof Error ? e.message : String(e)).slice(-300) }
  }
}
