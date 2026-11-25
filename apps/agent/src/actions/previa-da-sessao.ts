import { retratoDoGit, type RetratoDoGit } from './retrato-do-git'
import { resolverBaseDaSessao } from './base-da-sessao'
import { ambienteDePublicacao, branchPublicavel, type Executor } from '../exec/publicar-entrega'
import { executarPrograma } from '../exec/executar-programa'
import {
  caminhoNoContainer, executorDaSandbox, garantirPastaDoProjeto, idDeSessaoValido, pastaDaSessaoExiste,
  prepararCloneNaSandbox, regimeSandboxLigado, repositorioDoProjeto,
} from '../exec/sandbox'

/**
 * `supervised_session` com `dryRun: true` — o que o ProjectHandoff pergunta ANTES de enfileirar
 * (preflight) e DEPOIS que a tarefa termina (postflight). Item 7.2a, fatia B.
 *
 * ── Por que a mesma função serve aos dois momentos ───────────────────────────
 * É o desenho que o handoff já usa com `create_project_folder`: a prévia descreve o MUNDO, não
 * o plano. Antes, ela diz se o repositório existe, tem remoto e se o `gh` está autenticado.
 * Depois, a mesma pergunta revela se o branch da sessão está no remoto e se há PR — medido
 * aqui, de novo, em vez de confiar no relato que a sessão postou ao concluir. "O executor dizer
 * que terminou é relato, não prova" (handoff-sincronizacao.ts).
 *
 * ── Nada aqui escreve ────────────────────────────────────────────────────────
 * Só leitura: `rev-parse`, `remote get-url`, `ls-remote`, `gh auth status`, `gh pr view`.
 * Nenhum push, nenhum fetch que mexa em ref local. Uma prévia que mudasse o estado deixaria de
 * medir o que a execução vai encontrar.
 */

export interface EntregaMedida {
  /** Commit do branch NESTA máquina — a entrega quando não se publica. */
  readonly commitLocal: string | null
  /** Commit do branch no REMOTO (`ls-remote`), ou null se o branch não está lá. */
  readonly commitNoRemoto: string | null
  readonly prUrl: string | null
  readonly prEstado: string | null
  readonly prRascunho: boolean | null
  /** `true` quando a consulta ao remoto/gh não completou — ausência não medida não é ausência. */
  readonly inconclusiva: boolean
}

export interface PreviaDaSessao {
  readonly tipo: 'sessao_supervisionada'
  readonly branch: string
  readonly publicar: boolean
  readonly git: RetratoDoGit
  readonly remoto: string | null
  /** Só medido quando `publicar`; sem publicar, o gh não é pré-condição. */
  readonly ghAutenticado: boolean | null
  readonly entrega: EntregaMedida
  /** S3: `sandbox` quando a sessão roda no servidor; ausente no PC (regimes local e isolado). */
  readonly regime?: 'sandbox'
  /**
   * G3.2: continuação de uma sessão interrompida. Muda o que o preflight espera: o ramo TEM de
   * existir nesta máquina (é o trabalho salvo) e NÃO pode estar no remoto.
   */
  readonly retomada?: boolean
}

export type ResultadoDaPreviaDaSessao =
  | { readonly ok: true; readonly path: string; readonly previa: PreviaDaSessao }
  | { readonly ok: false; readonly error: string }

export function branchDaSessao(sessionId: string): string {
  return `rayzen/sessao-${sessionId.slice(0, 8)}`
}

export async function previaDaSessao(
  payload: { sessionId: string; projectId?: string; projectPath?: string; publicar?: boolean; retomaDe?: string },
  dependencias: { executar?: Executor; env?: NodeJS.ProcessEnv } = {},
): Promise<ResultadoDaPreviaDaSessao> {
  if (regimeSandboxLigado(dependencias.env ?? process.env) && !dependencias.executar) {
    return previaNaSandbox(payload)
  }
  if (payload.retomaDe !== undefined) {
    return { ok: false, error: 'retomar uma sessão interrompida só funciona na sandbox do servidor' }
  }
  // No agent-server a prévia também é só na sandbox — mesma regra da sessão.
  if ((dependencias.env ?? process.env).AGENT_ROLE === 'server' && !dependencias.executar) {
    return { ok: false, error: 'prévia de sessão no agent-server com a sandbox desligada (AGENT_SESSAO_SANDBOX) — recusada' }
  }
  const resolucao = await resolverBaseDaSessao({ projectId: payload.projectId, projectPath: payload.projectPath })
  if ('erro' in resolucao) return { ok: false, error: resolucao.erro }
  return medirPrevia(payload, resolucao.base, resolucao.base, dependencias)
}

/**
 * S3 (16/11): a mesma medição, feita DENTRO da sandbox, no clone do volume da sessão. É a única
 * prévia que escreve — e escreve só no volume próprio da sessão (o clone), que ninguém mais usa.
 * O `path` é `sandbox://dono/repo`: não existe pasta no host para apontar, e inventar uma seria
 * afirmar um checkout que não há.
 */
async function previaNaSandbox(
  payload: { sessionId: string; projectId?: string; publicar?: boolean; retomaDe?: string },
): Promise<ResultadoDaPreviaDaSessao> {
  if (payload.publicar !== true) {
    return { ok: false, error: 'na sandbox a entrega é sempre PR em rascunho: um ramo que não sai do servidor não é entrega — o envelope precisa de publicar: true' }
  }
  if (!payload.projectId) return { ok: false, error: 'a sandbox resolve o repositório pelo projectId, e ele não veio' }
  const alvo = await repositorioDoProjeto(payload.projectId)
  if ('erro' in alvo) return { ok: false, error: alvo.erro }
  const pasta = await garantirPastaDoProjeto(alvo.repo)
  if (!pasta.ok) return { ok: false, error: pasta.erro }
  const executar = executorDaSandbox(pasta.pasta)
  if (payload.retomaDe !== undefined) {
    // G3.2: mede a pasta da sessão ANTIGA, sem clonar — clonar recriaria uma pasta já limpa e
    // daria um ramo vazio, que a prévia leria como "nada a retomar" pelo motivo errado.
    if (!idDeSessaoValido(payload.retomaDe)) return { ok: false, error: `id de sessão inválido para retomar: "${String(payload.retomaDe).slice(0, 60)}"` }
    if (!(await pastaDaSessaoExiste(executar, payload.retomaDe))) {
      return { ok: false, error: 'a pasta da sessão interrompida já foi limpa no servidor: não há o que retomar' }
    }
    return medirPrevia(payload, caminhoNoContainer(payload.retomaDe), `sandbox://${alvo.dono}/${alvo.repo}`, { executar, env: {} }, 'sandbox')
  }
  const clone = await prepararCloneNaSandbox(executar, alvo.dono, alvo.repo, payload.sessionId ?? '')
  if (!clone.ok) return { ok: false, error: clone.erro }
  return medirPrevia(payload, clone.base, `sandbox://${alvo.dono}/${alvo.repo}`, { executar, env: {} }, 'sandbox')
}

async function medirPrevia(
  payload: { sessionId: string; publicar?: boolean; retomaDe?: string },
  base: string,
  path: string,
  dependencias: { executar?: Executor; env?: NodeJS.ProcessEnv },
  regime?: 'sandbox',
): Promise<ResultadoDaPreviaDaSessao> {
  const branch = branchDaSessao(payload.retomaDe ?? payload.sessionId ?? '')
  if (!branchPublicavel(branch)) {
    return { ok: false, error: `sessionId não produz branch publicável (${branch})` }
  }

  const executar = dependencias.executar
    ?? ((programa, args, opts) => executarPrograma('executavel', programa, args, opts))
  const env = dependencias.env ?? ambienteDePublicacao()
  const rodar = async (programa: string, args: readonly string[], timeoutMs = 20_000) => {
    try {
      const r = await executar(programa, args, { cwd: base, env, timeoutMs })
      return r.code === 0 && !r.timedOut ? r.stdout.trim() : null
    } catch {
      return null
    }
  }

  const publicar = payload.publicar === true
  const git = await retratoDoGit(base, dependencias.executar ?? undefined)
  const remoto = git.estado === 'repo' ? await rodar('git', ['remote', 'get-url', 'origin']) : null
  const ghAutenticado = publicar ? (await rodar('gh', ['auth', 'status'])) !== null : null

  const commitLocal = git.estado === 'repo'
    ? await rodar('git', ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`])
    : null
  let entrega: EntregaMedida = {
    commitLocal, commitNoRemoto: null, prUrl: null, prEstado: null, prRascunho: null,
    // Sem remoto, o remoto não foi medido — só importa quando a entrega é publicada.
    inconclusiva: publicar && !remoto,
  }
  if (remoto) {
    // `ls-remote` sai 0 com saída vazia quando o branch não existe — isso é ausência MEDIDA.
    // `null` (código ≠ 0) é não ter conseguido perguntar.
    const lsRemote = await rodar('git', ['ls-remote', '--heads', 'origin', `refs/heads/${branch}`], 30_000)
    const commitNoRemoto = lsRemote ? (lsRemote.split(/\s+/)[0] || null) : null
    let pr: { url?: string; state?: string; isDraft?: boolean } | null = null
    let prInconclusivo = false
    if (commitNoRemoto && publicar) {
      const bruto = await rodar('gh', ['pr', 'view', branch, '--json', 'url,state,isDraft'])
      try { pr = bruto ? JSON.parse(bruto) : null } catch { prInconclusivo = true }
    }
    entrega = {
      commitLocal,
      commitNoRemoto,
      prUrl: pr?.url ?? null,
      prEstado: pr?.state ?? null,
      prRascunho: typeof pr?.isDraft === 'boolean' ? pr.isDraft : null,
      inconclusiva: lsRemote === null || prInconclusivo,
    }
  }

  return {
    ok: true,
    path,
    previa: {
      tipo: 'sessao_supervisionada', branch, publicar, git, remoto, ghAutenticado, entrega,
      ...(regime ? { regime } : {}),
      ...(payload.retomaDe !== undefined ? { retomada: true } : {}),
    },
  }
}
