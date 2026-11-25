import { existsSync, readFileSync, statSync } from 'fs'
import { isAbsolute, normalize, relative, resolve, sep } from 'path'
import { resolverWorkdir } from '../exec/workdir'
import { executarPrograma, ambientePadrao } from '../exec/executar-programa'

/**
 * Leitura dos arquivos de um PROJETO, para o Hub e para a web — item 3 do plano de 11/11.
 *
 * ── Por que existe ───────────────────────────────────────────────────────────
 * Medido em 12/11: perguntado "liste os arquivos do repo" num projeto privado, o Hermes respondeu
 * com uma mistura de arquivos reais (vindos do estado do projeto) e dois que NÃO existem, com
 * autoria inventada ("adicionado por mim"). O Hub não tinha como ver o repositório. Num projeto
 * público ele lia a página do GitHub — o que mostra o remoto, não a máquina.
 *
 * ── As travas, e por que estas e não `list_dir`/`file_read` ───────────────────
 * - O checkout vem do `projectId` (`resolverWorkdir`), nunca de um caminho do chamador; o caminho
 *   pedido é RELATIVO ao checkout e não sai dele (`..`, absoluto e link para fora são recusados).
 * - `file_read` lê qualquer coisa sob as raízes seguras, `.env` inclusive. Aqui segredo é recusado
 *   pelo NOME, a mesma família da lista de negação da sessão supervisionada. Listar o nome de um
 *   `.env` é inofensivo e útil ("existe um .env aqui"); ler o conteúdo, não.
 * - Listagem por `git ls-files`: respeita o `.gitignore` (sem `node_modules`/`dist`) e marca o
 *   que ainda não foi commitado — a diferença entre "está no repo" e "está só na máquina".
 * - Arquivo inexistente é RESPOSTA (`existe: false`), não exceção: é o que a web mostra quando o
 *   modelo cita um arquivo que não existe, e é o caso que motivou tudo isto.
 */

const SEGREDO = [
  /(^|\/)\.env$/i, /(^|\/)\.env\.(?!example$|sample$|template$)[^/]+$/i,
  /\.(pem|key|p12|pfx)$/i, /(^|\/)id_(rsa|ed25519|ecdsa)[^/]*$/i,
  /(^|\/)hook\.config\.mjs$/i, /(^|\/)\.npmrc$/i, /(^|\/)\.netrc$/i,
  /(^|\/)\.(ssh|aws|gnupg)\//i, /(^|\/)credentials(\.json)?$/i,
]

export function ehSegredo(caminhoRelativo: string): boolean {
  const p = caminhoRelativo.replace(/\\/g, '/')
  return SEGREDO.some((r) => r.test(p))
}

const LIMITE_LEITURA_BYTES = 200 * 1024
const LIMITE_LISTAGEM = 2000

type Resolvedor = (projectId: string) => Promise<string | null>

/** Caminho relativo seguro dentro do checkout, ou `null` se tentar sair dele. */
export function dentroDoCheckout(checkout: string, pedido: string): { absoluto: string; relativo: string } | null {
  const limpo = (pedido ?? '').trim().replace(/\\/g, '/').replace(/^\.\/+/, '')
  if (isAbsolute(limpo) || /^[a-z]:/i.test(limpo)) return null
  const absoluto = resolve(checkout, normalize(limpo || '.'))
  const rel = relative(resolve(checkout), absoluto)
  if (rel.startsWith('..') || isAbsolute(rel)) return null
  return { absoluto, relativo: rel.split(sep).join('/') }
}

async function checkoutDoProjeto(projectId: string | undefined, resolver: Resolvedor): Promise<string> {
  if (!projectId) throw new Error('projectId é obrigatório — o checkout é resolvido pelo projeto')
  const checkout = await resolver(projectId)
  if (!checkout) throw new Error(`o projeto ${projectId} não tem checkout resolvível nesta máquina`)
  return checkout
}

async function gitLinhas(cwd: string, args: string[]): Promise<string[] | null> {
  try {
    const r = await executarPrograma('executavel', 'git', args, { cwd, env: ambientePadrao(), timeoutMs: 20_000 })
    if (r.code !== 0 || r.timedOut) return null
    return r.stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  } catch {
    return null
  }
}

export async function listarArquivosDoProjeto(
  payload: { projectId?: string; path?: string },
  dependencias: { resolver?: Resolvedor } = {},
) {
  const checkout = await checkoutDoProjeto(payload.projectId, dependencias.resolver ?? resolverWorkdir)
  const alvo = dentroDoCheckout(checkout, payload.path ?? '')
  if (!alvo) throw new Error('caminho fora do checkout do projeto')
  const prefixo = alvo.relativo === '' ? '' : `${alvo.relativo.replace(/\/$/, '')}/`

  const rastreados = await gitLinhas(checkout, ['ls-files'])
  const novos = await gitLinhas(checkout, ['ls-files', '--others', '--exclude-standard'])
  if (!rastreados) throw new Error('o checkout não é um repositório git — listagem indisponível')

  const naoCommitados = new Set(novos ?? [])
  const todos = [...rastreados, ...(novos ?? [])]
    .filter((f, i, a) => a.indexOf(f) === i)
    .filter((f) => prefixo === '' || f.startsWith(prefixo))
    .sort()

  return {
    projectId: payload.projectId,
    caminho: alvo.relativo || '.',
    total: todos.length,
    truncado: todos.length > LIMITE_LISTAGEM,
    arquivos: todos.slice(0, LIMITE_LISTAGEM).map((path) => ({
      path,
      ...(naoCommitados.has(path) ? { naoCommitado: true } : {}),
      ...(ehSegredo(path) ? { segredo: true } : {}),
    })),
  }
}

export async function lerArquivoDoProjeto(
  payload: { projectId?: string; path?: string },
  dependencias: { resolver?: Resolvedor } = {},
) {
  const checkout = await checkoutDoProjeto(payload.projectId, dependencias.resolver ?? resolverWorkdir)
  const alvo = dentroDoCheckout(checkout, payload.path ?? '')
  if (!alvo || alvo.relativo === '') throw new Error('caminho fora do checkout do projeto')
  if (ehSegredo(alvo.relativo)) {
    return { path: alvo.relativo, existe: existsSync(alvo.absoluto), recusado: 'segredo' as const }
  }
  if (!existsSync(alvo.absoluto)) return { path: alvo.relativo, existe: false }

  const st = statSync(alvo.absoluto)
  if (st.isDirectory()) return { path: alvo.relativo, existe: true, diretorio: true }
  const bruto = readFileSync(alvo.absoluto)
  const amostra = bruto.subarray(0, Math.min(bruto.length, 8000))
  if (amostra.includes(0)) return { path: alvo.relativo, existe: true, binario: true, bytes: st.size }

  const truncado = bruto.length > LIMITE_LEITURA_BYTES
  const conteudo = bruto.subarray(0, LIMITE_LEITURA_BYTES).toString('utf8')
  return { path: alvo.relativo, existe: true, bytes: st.size, truncado, conteudo }
}
