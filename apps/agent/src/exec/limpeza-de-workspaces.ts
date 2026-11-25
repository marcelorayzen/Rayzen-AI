import { ambientePadrao, executarPrograma, type ResultadoDeExecucao } from './executar-programa'
import {
  IMAGEM_DA_SANDBOX, executorDaSandbox, pastaDoProjetoNoHost, raizDosWorkspaces,
} from './sandbox'
import { beatComponente } from '../system-heartbeat-client'
import { pararPreviaVencida } from './previa-ao-vivo'

/**
 * Limpeza das pastas de sessão em `~/workspaces/<repo>/sessao-<id>/` (17/11/2026, decisão do
 * Marcelo: "podem ser apagadas após merge ou cancelada — vai se acumular muito rápido").
 *
 * | estado do PR do ramo da sessão  | pasta                                   |
 * |---------------------------------|-----------------------------------------|
 * | MERGED ou CLOSED                | apaga                                   |
 * | nenhum PR, pasta com +24 h      | apaga (recusa, falha, ou só a prévia)   |
 * | OPEN                            | mantém — trabalho ainda em revisão      |
 * | o GitHub não respondeu          | mantém — sem medir, não apaga           |
 *
 * Apagar roda num container mínimo (sem rede, sem credencial, uid do dono) com SÓ a pasta do
 * projeto montada, e o nome da subpasta validado: nada fora de `sessao-[a-z0-9]+` é tocado.
 */

const PASTA_DE_SESSAO = /^sessao-[a-z0-9]{1,12}$/
const NOME_SIMPLES = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/
const IDADE_SEM_PR_MS = 24 * 60 * 60 * 1000
// 1 h, e não no fim da sessão: o postflight do envelope REFAZ o clone na mesma pasta para medir a
// entrega, então apagar na hora seria desfeito logo depois. A varredura é o único lugar da regra.
const TICK_MS = 60 * 60 * 1000

type Rodar = (programa: string, args: readonly string[], opts: { cwd: string; env: NodeJS.ProcessEnv; timeoutMs: number }) => Promise<ResultadoDeExecucao>
const rodarNoHost: Rodar = (programa, args, opts) => executarPrograma('executavel', programa, args, opts)

export interface PastaDeSessao { repo: string; pasta: string; modificadaEm: number }
export type EstadoDoPr = 'MERGED' | 'CLOSED' | 'OPEN' | 'NENHUM' | 'INCONCLUSIVO'

/** O ramo da sessão: `rayzen/sessao-` + os 8 primeiros do id (o mesmo de `branchDaSessao`). */
export function ramoDaPasta(pasta: string): string {
  return `rayzen/${pasta.slice(0, 'sessao-'.length + 8)}`
}

export function deveApagar(estado: EstadoDoPr, idadeMs: number): boolean {
  if (estado === 'MERGED' || estado === 'CLOSED') return true
  if (estado === 'NENHUM') return idadeMs > IDADE_SEM_PR_MS
  return false
}

function containerMinimo(montarEm: string, alvo: string, comando: string[]): string[] {
  return [
    'run', '--rm', '--network', 'none', '--user', '1000:1000', '--cap-drop', 'ALL',
    '--security-opt', 'no-new-privileges:true',
    '--mount', `type=bind,src=${montarEm},dst=${alvo}`,
    IMAGEM_DA_SANDBOX, ...comando,
  ]
}

/** Lista `repo/sessao-*` com a data de modificação, sem rede e sem credencial. */
export async function listarPastasDeSessao(rodar: Rodar = rodarNoHost, env: NodeJS.ProcessEnv = process.env): Promise<PastaDeSessao[]> {
  const raiz = raizDosWorkspaces(env)
  const r = await rodar('docker', containerMinimo(raiz, '/ws', [
    'find', '/ws', '-mindepth', '2', '-maxdepth', '2', '-type', 'd', '-name', 'sessao-*', '-printf', '%P %T@\\n',
  ]), { cwd: '/', env: ambientePadrao(env), timeoutMs: 60_000 })
  if (r.code !== 0) throw new Error(`não consegui listar ${raiz}: ${r.stderr.trim().slice(-200)}`)
  return r.stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).flatMap((l) => {
    const [caminho, mtime] = l.split(' ')
    const [repo, pasta] = (caminho ?? '').split('/')
    if (!NOME_SIMPLES.test(repo ?? '') || !PASTA_DE_SESSAO.test(pasta ?? '')) return []
    return [{ repo, pasta, modificadaEm: Math.round(Number(mtime) * 1000) }]
  })
}

/** Estado do PR do ramo da sessão, perguntado ao GitHub de dentro da sandbox (com o token dela). */
export async function estadoDoPr(p: PastaDeSessao, rodar: Rodar = rodarNoHost): Promise<EstadoDoPr> {
  const executar = executorDaSandbox(pastaDoProjetoNoHost(p.repo), rodar)
  const r = await executar('gh', ['pr', 'view', ramoDaPasta(p.pasta), '--json', 'state', '--jq', '.state'],
    { cwd: `/work/${p.pasta}`, env: {}, timeoutMs: 60_000 })
  const saida = r.stdout.trim()
  if (r.code === 0 && (saida === 'MERGED' || saida === 'CLOSED' || saida === 'OPEN')) return saida
  // "no pull requests found" é resposta: não existe PR. Qualquer outra falha é não ter medido.
  if (/no pull requests found/i.test(r.stderr)) return 'NENHUM'
  return 'INCONCLUSIVO'
}

/** Apaga UMA pasta de sessão. Só aceita `sessao-[a-z0-9]+` dentro da pasta do projeto. */
export async function apagarPastaDeSessao(
  repo: string, pasta: string, rodar: Rodar = rodarNoHost, env: NodeJS.ProcessEnv = process.env,
): Promise<boolean> {
  if (!NOME_SIMPLES.test(repo) || !PASTA_DE_SESSAO.test(pasta)) return false
  const r = await rodar('docker', containerMinimo(pastaDoProjetoNoHost(repo, env), '/work', ['rm', '-rf', '--', `/work/${pasta}`]),
    { cwd: '/', env: ambientePadrao(env), timeoutMs: 120_000 })
  return r.code === 0
}

export interface ResultadoDaLimpeza { vistas: number; apagadas: string[]; mantidas: number; inconclusivas: number }

export async function limparUmaVez(
  agora = Date.now(),
  deps: { listar?: typeof listarPastasDeSessao; estado?: typeof estadoDoPr; apagar?: typeof apagarPastaDeSessao } = {},
): Promise<ResultadoDaLimpeza> {
  const listar = deps.listar ?? listarPastasDeSessao
  const estado = deps.estado ?? estadoDoPr
  const apagar = deps.apagar ?? apagarPastaDeSessao
  const pastas = await listar()
  const resultado: ResultadoDaLimpeza = { vistas: pastas.length, apagadas: [], mantidas: 0, inconclusivas: 0 }
  for (const p of pastas) {
    const e = await estado(p)
    if (e === 'INCONCLUSIVO') resultado.inconclusivas++
    if (deveApagar(e, agora - p.modificadaEm) && await apagar(p.repo, p.pasta)) {
      resultado.apagadas.push(`${p.repo}/${p.pasta} (${e === 'NENHUM' ? 'sem PR' : e.toLowerCase()})`)
    } else {
      resultado.mantidas++
    }
  }
  return resultado
}

async function cicloComBatimento(): Promise<void> {
  let ok = false
  let erro: string | undefined
  let detalhe: Record<string, unknown> = {}
  try {
    const r = await limparUmaVez()
    // Item 3 (17/11): a prévia ao vivo vive 2 h; a mesma varredura a desliga depois disso.
    const previa = await pararPreviaVencida()
    detalhe = { ...r, previa }
    ok = true
    if (r.apagadas.length) console.log(`[limpeza-workspaces] apagadas: ${r.apagadas.join(', ')}`)
  } catch (e) {
    erro = e instanceof Error ? e.message : String(e)
    console.warn(`[limpeza-workspaces] ${erro}`)
  } finally {
    await beatComponente('limpeza-workspaces', { ok, erro, detalhe })
  }
}

/** Só no agent-server com a sandbox ligada — é onde as pastas existem. */
export function startLimpezaDeWorkspaces(env: NodeJS.ProcessEnv = process.env): void {
  if (env.AGENT_ROLE !== 'server' || env.AGENT_SESSAO_SANDBOX !== 'true') return
  if (env.AGENT_LIMPEZA_WORKSPACES_ENABLED === 'false') return
  console.log(`[limpeza-workspaces] ativa — ${raizDosWorkspaces(env)} a cada 1 h`)
  setTimeout(() => {
    void cicloComBatimento()
    setInterval(() => { void cicloComBatimento() }, TICK_MS)
  }, 5 * 60 * 1000)
}

