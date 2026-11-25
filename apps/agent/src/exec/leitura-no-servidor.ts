import { posix } from 'path'
import { executorDaSandbox, garantirPastaDoProjeto, regimeSandboxLigado, repositorioDoProjeto } from './sandbox'
import type { Executor } from './publicar-entrega'
import { ehSegredo } from '../actions/arquivos-do-projeto'

/**
 * Leitura de arquivos do projeto PELO SERVIDOR (17/11/2026) — o Hub deixa de atravessar até o PC.
 *
 * Medido em 17/11: numa resposta de código, as ferramentas somavam 25–36 s, e cada leitura ia
 * Hub → api → agent desktop → disco do PC → volta. Aqui a leitura é um `docker run` da sandbox
 * (~0,3 s) sobre um clone-espelho em `~/workspaces/<repo>/leitura`, atualizado do GitHub no
 * máximo uma vez por minuto.
 *
 * ── O que muda de significado ────────────────────────────────────────────────
 * O espelho é o ramo padrão do GitHub, não o disco do PC: trabalho não enviado não aparece. Cada
 * resposta diz `fonte`, para o Hub não afirmar "o projeto tem X" sobre o que é só do remoto.
 *
 * ── As mesmas travas da leitura do PC ────────────────────────────────────────
 * Caminho relativo e dentro do clone, segredo recusado pelo nome (`ehSegredo`, a mesma regra),
 * 200 KB por leitura, binário não é despejado. O container só enxerga a pasta do projeto.
 */

const ESPELHO = 'leitura'
const RAIZ = `/work/${ESPELHO}`
const LIMITE_LEITURA_BYTES = 200 * 1024
const LIMITE_LISTAGEM = 2000
const FRESCOR_MS = 60_000

/** Ligado só no agent-server com a sandbox, e por decisão explícita. */
export function leituraNoServidorLigada(env: NodeJS.ProcessEnv = process.env): boolean {
  return regimeSandboxLigado(env) && env.AGENT_LEITURA_NO_SERVIDOR === 'true'
}

const ultimaAtualizacao = new Map<string, number>()

export interface Espelho { executar: Executor; fonte: string }

/** Prepara (clona ou atualiza) o espelho do projeto. Atualiza no máximo uma vez por minuto. */
export async function espelhoDoProjeto(
  projectId: string | undefined,
  deps: {
    repositorio?: typeof repositorioDoProjeto
    garantirPasta?: typeof garantirPastaDoProjeto
    executorPara?: (pasta: string) => Executor
    agora?: () => number
  } = {},
): Promise<Espelho> {
  if (!projectId) throw new Error('projectId é obrigatório — o espelho é resolvido pelo projeto')
  const alvo = await (deps.repositorio ?? repositorioDoProjeto)(projectId)
  if ('erro' in alvo) throw new Error(alvo.erro)
  const pasta = await (deps.garantirPasta ?? garantirPastaDoProjeto)(alvo.repo)
  if (!pasta.ok) throw new Error(pasta.erro)
  const executar = (deps.executorPara ?? executorDaSandbox)(pasta.pasta)
  const agora = (deps.agora ?? Date.now)()
  const chave = `${alvo.dono}/${alvo.repo}`
  if (agora - (ultimaAtualizacao.get(chave) ?? 0) > FRESCOR_MS) {
    // Espelho é do Rayzen, nunca editado à mão: alinha com o remoto sem perguntar.
    // O clone já leva o `gh` como credencial (23/11): antes ele só era configurado depois do clone,
    // e todo repositório PRIVADO falhava no primeiro clone com "could not read Username". Os
    // espelhos que existiam eram todos de repositórios públicos, e por isso ninguém viu.
    const script = [
      'set -e', 'cd /work',
      `[ -d ${ESPELHO}/.git ] || git -c credential.helper='!gh auth git-credential' clone -q --depth 50 "https://github.com/$1/$2.git" ${ESPELHO}`,
      `cd ${ESPELHO}`,
      'git config credential.helper "!gh auth git-credential"',
      'git fetch -q --depth 50 origin',
      'git reset -q --hard "$(git symbolic-ref --quiet refs/remotes/origin/HEAD || echo origin/main)"',
    ].join('\n')
    const r = await executar('bash', ['-c', script, '_', alvo.dono, alvo.repo], { cwd: '/work', env: {}, timeoutMs: 180_000 })
    if (r.code !== 0 || r.timedOut) {
      throw new Error(`não consegui atualizar o espelho de ${chave}: ${(r.timedOut ? 'tempo esgotado' : r.stderr.trim()).slice(-200)}`)
    }
    ultimaAtualizacao.set(chave, agora)
  }
  return { executar, fonte: `servidor — ramo padrão de github.com/${chave}` }
}

/** Caminho pedido → relativo ao espelho, ou null se sai dele. Mesma regra do PC, em POSIX. */
export function dentroDoEspelho(pedido: string): string | null {
  const limpo = (pedido ?? '').trim().replace(/\\/g, '/').replace(/^\.\/+/, '')
  if (limpo.startsWith('/') || /^[a-z]:/i.test(limpo)) return null
  const rel = posix.relative(RAIZ, posix.resolve(RAIZ, posix.normalize(limpo || '.')))
  if (rel.startsWith('..') || posix.isAbsolute(rel)) return null
  return rel
}

export async function listarNoServidor(payload: { projectId?: string; path?: string }, espelho?: Espelho) {
  const { executar, fonte } = espelho ?? await espelhoDoProjeto(payload.projectId)
  const rel = dentroDoEspelho(payload.path ?? '')
  if (rel === null) throw new Error('caminho fora do checkout do projeto')
  const r = await executar('git', ['ls-files'], { cwd: RAIZ, env: {}, timeoutMs: 30_000 })
  if (r.code !== 0) throw new Error('o espelho não é um repositório git — listagem indisponível')
  const prefixo = rel === '' ? '' : `${rel.replace(/\/$/, '')}/`
  const todos = r.stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
    .filter((f) => prefixo === '' || f.startsWith(prefixo)).sort()
  return {
    projectId: payload.projectId, fonte, caminho: rel || '.', total: todos.length,
    truncado: todos.length > LIMITE_LISTAGEM,
    arquivos: todos.slice(0, LIMITE_LISTAGEM).map((path) => ({ path, ...(ehSegredo(path) ? { segredo: true } : {}) })),
  }
}

export async function lerNoServidor(payload: { projectId?: string; path?: string }, espelho?: Espelho) {
  const rel = dentroDoEspelho(payload.path ?? '')
  if (rel === null || rel === '') throw new Error('caminho fora do checkout do projeto')
  // Segredo é recusado ANTES de qualquer container ser chamado — nem a existência é consultada.
  if (ehSegredo(rel)) return { path: rel, recusado: 'segredo' as const }
  const { executar, fonte } = espelho ?? await espelhoDoProjeto(payload.projectId)
  // O caminho vai como argumento posicional, nunca dentro do script.
  const script = [
    'f="$1"',
    '[ -e "$f" ] || { echo NAOEXISTE; exit 0; }',
    '[ -d "$f" ] && { echo DIRETORIO; exit 0; }',
    'total=$(stat -c %s -- "$f")',
    'nulos=$(head -c 8000 -- "$f" | tr -dc "\\000" | wc -c)',
    '[ "$nulos" -gt 0 ] && { echo "BINARIO $total"; exit 0; }',
    'echo "TEXTO $total"',
    `head -c ${LIMITE_LEITURA_BYTES} -- "$f"`,
  ].join('\n')
  const r = await executar('bash', ['-c', script, '_', rel], { cwd: RAIZ, env: {}, timeoutMs: 30_000 })
  if (r.code !== 0) throw new Error(`não consegui ler ${rel} no servidor: ${r.stderr.trim().slice(-200)}`)
  const quebra = r.stdout.indexOf('\n')
  const cabecalho = (quebra === -1 ? r.stdout : r.stdout.slice(0, quebra)).trim()
  const [tipo, tamanho] = cabecalho.split(' ')
  if (tipo === 'NAOEXISTE') return { path: rel, existe: false, fonte }
  if (tipo === 'DIRETORIO') return { path: rel, existe: true, diretorio: true, fonte }
  const bytes = Number(tamanho)
  if (tipo === 'BINARIO') return { path: rel, existe: true, binario: true, bytes, fonte }
  return {
    path: rel, existe: true, bytes, fonte,
    truncado: bytes > LIMITE_LEITURA_BYTES,
    conteudo: quebra === -1 ? '' : r.stdout.slice(quebra + 1),
  }
}
