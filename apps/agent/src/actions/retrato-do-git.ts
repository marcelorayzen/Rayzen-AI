import { executarPrograma, ambientePadrao } from '../exec/executar-programa'

/**
 * O estado do git num caminho, medido — não deduzido da existência de uma pasta `.git`.
 *
 * ── Três estados, e o terceiro é o que costuma ser perdido ──────────────────
 * `nao-repo` afirma que ali não há repositório. `inconclusivo` diz que **não deu para
 * medir** — git ausente do PATH, permissão negada, timeout. Colapsar o segundo no primeiro é
 * o erro que esta casa evita em `historico_serve_conversa` e na sonda de LLM: quem não
 * conseguiu perguntar não pode responder pelo alvo.
 *
 * A distinção é estrutural, não por texto de erro: `git rev-parse` sai com 128 e diz "not a
 * git repository" quando não é repo. Qualquer outra falha é não ter conseguido olhar.
 *
 * ── Por que `rev-parse --show-toplevel` e não `existsSync('.git')` ──────────
 * `.git` existir não prova repositório utilizável, e — o que importa aqui — um diretório
 * SEM `.git` pode estar **dentro** de um repositório cuja raiz é acima dele. É exatamente
 * esse caso que torna um `git init` aninhado possível, e `existsSync` é cego para ele.
 */
export interface RetratoDoGit {
  estado: 'repo' | 'nao-repo' | 'inconclusivo'
  /** Caminho onde a medição foi feita — sem isto o retrato não diz do que ele fala. */
  medidoEm: string
  /** Raiz do repositório que contém o caminho medido. Pode ser ACIMA dele. */
  raiz?: string | null
  branch?: string | null
  head?: string | null
  naoCommitados?: number | null
  /** Por que ficou inconclusivo. Ausente quando não é o caso. */
  motivo?: string
}

const OPTS = { env: ambientePadrao(), timeoutMs: 10_000 }

type ExecutorDoGit = (programa: string, args: readonly string[], opts: { cwd: string; env: NodeJS.ProcessEnv; timeoutMs: number }) =>
  Promise<{ stdout: string; stderr: string; code: number | null }>

const executorLocal: ExecutorDoGit = (programa, args, opts) => executarPrograma('executavel', programa, args, opts)

/**
 * `executar` (S3, 16/11): o regime sandbox mede o git DENTRO do container, no clone do volume —
 * a mesma medição, outro lugar. Sem ele, o comportamento é o de sempre: git local.
 */
export async function retratoDoGit(caminho: string, executar: ExecutorDoGit = executorLocal): Promise<RetratoDoGit> {
  const git = async (args: string[], cwd: string): Promise<{ code: number; out: string; err: string }> => {
    const r = await executar('git', args, { ...OPTS, cwd })
    return { code: r.code ?? -1, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim() }
  }
  const base: RetratoDoGit = { estado: 'inconclusivo', medidoEm: caminho }

  let topo
  try {
    topo = await git(['rev-parse', '--show-toplevel'], caminho)
  } catch (e) {
    return { ...base, motivo: `não consegui executar git: ${e instanceof Error ? e.message : String(e)}` }
  }

  if (topo.code !== 0) {
    // "not a git repository" é resposta; o resto é ausência de resposta.
    if (/not a git repository/i.test(topo.err)) return { ...base, estado: 'nao-repo' }
    return { ...base, motivo: `git rev-parse saiu ${topo.code}: ${topo.err.slice(0, 120)}` }
  }

  // Daqui para baixo já se sabe que é repositório. Uma consulta que falhe não desfaz isso —
  // ela deixa o campo nulo, porque "é repo mas não sei o branch" continua sendo mais verdade
  // que "inconclusivo".
  const [branch, head, status] = await Promise.all([
    git(['branch', '--show-current'], caminho).catch(() => null),
    git(['rev-parse', 'HEAD'], caminho).catch(() => null),
    git(['status', '--porcelain'], caminho).catch(() => null),
  ])

  return {
    estado: 'repo',
    medidoEm: caminho,
    raiz: topo.out || null,
    branch: branch?.code === 0 ? (branch.out || null) : null,
    head: head?.code === 0 ? (head.out || null) : null,
    naoCommitados: status?.code === 0
      ? status.out.split(/\r?\n/).filter((l) => l.trim().length > 0).length
      : null,
  }
}
