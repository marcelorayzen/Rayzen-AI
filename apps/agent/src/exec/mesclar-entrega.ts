import { classificarResposta } from '../actions/resposta-aprovacao'
import type { Executor } from './publicar-entrega'

/**
 * "Aprovado, mesclar" no portão do diff (16/11/2026, pedido do Marcelo: abrir cada PR no GitHub
 * só para clicar em merge "seria de extrema constância").
 *
 * ── A revisão já aconteceu; o CI é a trava que falta ───────────────────────────
 * A pessoa vê o diff inteiro no fio antes de qualquer publicação — é revisão de verdade. O que
 * o merge acrescenta de risco é código que não passa nos testes do projeto entrar no `main`. Por
 * isso: só oferece mesclar onde há CI (`.github/workflows/`), espera TODOS os checks do PR, e
 * qualquer falha, cancelamento ou ausência de check deixa o PR aberto e diz por quê. Nunca
 * mescla "porque não deu para medir".
 *
 * ── O ramo NÃO é apagado ─────────────────────────────────────────────────────
 * O postflight do envelope mede a entrega pelo ramo no remoto (`ls-remote`). Apagá-lo faria
 * uma entrega mesclada aparecer como "ausente". A limpeza de ramos é configuração do repositório
 * ("Automatically delete head branches"), não decisão desta sessão.
 */

export type DecisaoDePublicacao = 'mesclar' | 'so_pr' | 'nao'

export const OPCOES_COM_MERGE = ['Aprovado, mesclar', 'Aprovado, só abrir PR', 'Não publicar'] as const
export const OPCOES_SEM_MERGE = ['Aprovado, publicar', 'Não publicar'] as const

/**
 * Fecha por padrão: só uma aprovação CLARA publica, e só a que fala em mesclar mescla. O índice
 * segue a ordem das opções mostradas — com merge, "2" é "só abrir PR", não rejeição.
 */
export function decidirPublicacao(reply: string | null | undefined, comMerge: boolean): DecisaoDePublicacao {
  const cru = (reply ?? '').trim()
  const indice = /^([123])[.)\s]*$/.exec(cru)
  if (indice) {
    const n = Number(indice[1])
    if (comMerge) return n === 1 ? 'mesclar' : n === 2 ? 'so_pr' : 'nao'
    return n === 1 ? 'so_pr' : 'nao'
  }
  if (classificarResposta(cru) !== 'aprovado') return 'nao'
  const texto = cru.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  const pedeMerge = /(mescl|merge)/.test(texto) && !/(so abrir|apenas abrir|sem mescl|sem merge)/.test(texto)
  return comMerge && pedeMerge ? 'mesclar' : 'so_pr'
}

/** O repositório tem CI? Sem workflow, não há o que esperar — e mesclar não é oferecido. */
export async function temIntegracaoContinua(executar: Executor, repo: string): Promise<boolean> {
  try {
    const r = await executar('git', ['ls-files', '--', '.github/workflows'], { cwd: repo, env: {}, timeoutMs: 20_000 })
    return r.code === 0 && /\.ya?ml\s*$/m.test(r.stdout)
  } catch {
    return false
  }
}

export type ResultadoDoMerge =
  | { ok: true; commit: string | null; checks: number }
  | { ok: false; motivo: 'ci_falhou' | 'ci_ausente' | 'ci_demorou' | 'merge_falhou'; detalhe: string }

interface Check { name?: string; bucket?: string; state?: string }

/**
 * Espera os checks do PR e, todos verdes, mescla (squash). `esperar` é injetável para o teste
 * não dormir de verdade.
 */
export async function mesclarQuandoCiPassar(
  executar: Executor,
  repo: string,
  ramo: string,
  opts: { tetoMs?: number; intervaloMs?: number; esperaPorChecksMs?: number; esperar?: (ms: number) => Promise<void> } = {},
): Promise<ResultadoDoMerge> {
  const teto = opts.tetoMs ?? 25 * 60 * 1000
  const intervalo = opts.intervaloMs ?? 20_000
  const esperaPorChecks = opts.esperaPorChecksMs ?? 3 * 60 * 1000
  const esperar = opts.esperar ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const gh = (args: string[], timeoutMs = 60_000) => executar('gh', args, { cwd: repo, env: {}, timeoutMs })

  let decorrido = 0
  for (;;) {
    const r = await gh(['pr', 'checks', ramo, '--json', 'name,bucket,state'])
    let checks: Check[] = []
    try { checks = JSON.parse(r.stdout || '[]') } catch { checks = [] }

    const falhos = checks.filter((c) => c.bucket === 'fail' || c.bucket === 'cancel')
    if (falhos.length > 0) {
      return { ok: false, motivo: 'ci_falhou', detalhe: `checks com falha: ${falhos.map((c) => c.name ?? '?').join(', ')}` }
    }
    const pendentes = checks.filter((c) => c.bucket === 'pending' || !c.bucket)
    if (checks.length > 0 && pendentes.length === 0) {
      return mesclar(gh, ramo, checks.length)
    }
    // Logo depois do push o GitHub ainda não registrou os checks: esperar um pouco antes de
    // concluir que não há CI. Passado esse tempo sem nenhum check, não mescla.
    if (checks.length === 0 && decorrido >= esperaPorChecks) {
      return { ok: false, motivo: 'ci_ausente', detalhe: 'nenhum check apareceu no PR — sem CI medido, não mesclo' }
    }
    if (decorrido >= teto) {
      return { ok: false, motivo: 'ci_demorou', detalhe: `o CI não terminou em ${Math.round(teto / 60000)} min` }
    }
    await esperar(intervalo)
    decorrido += intervalo
  }
}

async function mesclar(
  gh: (args: string[], timeoutMs?: number) => ReturnType<Executor>,
  ramo: string,
  checks: number,
): Promise<ResultadoDoMerge> {
  // Rascunho não se mescla: sai do rascunho primeiro.
  await gh(['pr', 'ready', ramo])
  const m = await gh(['pr', 'merge', ramo, '--squash'], 120_000)
  // Medido, não presumido: o estado do PR depois do merge.
  const v = await gh(['pr', 'view', ramo, '--json', 'state,mergeCommit'])
  let estado: { state?: string; mergeCommit?: { oid?: string } | null } = {}
  try { estado = JSON.parse(v.stdout || '{}') } catch { estado = {} }
  if (estado.state === 'MERGED') return { ok: true, commit: estado.mergeCommit?.oid ?? null, checks }
  return { ok: false, motivo: 'merge_falhou', detalhe: (m.stderr || m.stdout || `estado ${estado.state ?? 'desconhecido'}`).trim().slice(-300) }
}
