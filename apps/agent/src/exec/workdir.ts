import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { execFileSync } from 'child_process'
import { request } from 'node:http'
import { request as httpsRequest } from 'node:https'

/**
 * Fase 3 do plano de execução tipada — `workdir` por `projectId`, nunca por caminho livre.
 *
 * Hoje `payload.path` é resolvido e checado contra `SAFE_ROOTS` (`path-guard.ts`). Funciona,
 * mas o contrato ainda é "me diga um caminho" — o chamador (LLM, specialist) inventa uma
 * string e o agent só verifica se ela é SEGURA, nunca se ela é a certa. `resolverWorkdir()`
 * inverte isso: o chamador manda `projectId` (o mesmo que já usa para tudo mais — contexto,
 * eventos, checkpoint), e o agent resolve o diretório sozinho. Caminho que não estiver no
 * registro não existe para o executor — não há mais "caminho arbitrário que passou no guard".
 *
 * ## Como o registro é preenchido
 *
 * Não há hoje nenhum `projectId → caminho local` em lugar nenhum — a direção que já existe
 * (`repo-slug.mjs`, usado pelo hook/MCP) é a OPOSTA: caminho → repoSlug. Este módulo faz o
 * caminho completo: pergunta ao Rayzen o `repoSlug` do `projectId` (`GET /projects/:id`),
 * depois varre os diretórios de projeto locais até achar um cujo `repoSlug` bate — crua ou
 * kebab, mesma ordem que `repo-slug.mjs` usa para resolver o sentido contrário. O resultado
 * fica em cache (TTL de 1h — projeto não muda de pasta com frequência).
 *
 * ## Por que a resolução de repoSlug está duplicada aqui, e não importada de `repo-slug.mjs`
 *
 * `repo-slug.mjs` é ESM puro, carregado sem build pelos três `.mjs` de entrada (hook,
 * context-hook, MCP) — é o motivo dele existir separado de `packages/types` (ver o
 * comentário no topo do próprio arquivo). Este módulo, ao contrário, é parte do AGENT
 * (`tsconfig.json`: `"module": "CommonJS"`), que compila para `dist/`. Um `.ts` CommonJS não
 * consegue `require()` um `.mjs` ESM de forma síncrona — só `import()` dinâmico, mudando a
 * forma de toda chamada por uma dependência de três funções pequenas.
 *
 * A saída é a mesma desta casa para o mesmo problema em outro lugar: `event-derived-text.const.ts`
 * e `memory-ranking.const.ts` são duplicados entre V1 e V2 porque `@rayzen/types` não é
 * compilado, cada um com teste anti-drift que lê o arquivo irmão como texto. Aqui é a mesma
 * ideia — `workdir.spec.ts` lê `repo-slug.mjs` como texto e falha se a lógica de resolução
 * divergir.
 */

const HOME = process.env.USERPROFILE ?? process.env.HOME ?? ''

/** Onde projeto mora, por convenção desta casa — não é `SAFE_ROOTS` inteiro (que inclui
 * Downloads/Documents/Desktop, lugares seguros para ESCREVER, não onde projeto costuma estar). */
const RAIZES_DE_PROJETO = [
  join(HOME, 'Projects'),
  ...(process.env.AGENT_PROJECT_ROOT ? [process.env.AGENT_PROJECT_ROOT] : []),
]

// ── Resolução de repoSlug — duplicada de repo-slug.mjs, ver o porquê acima ──────────────────

function git(args: string[], cwd: string): string {
  try {
    return execFileSync('git', args, {
      cwd, encoding: 'utf8', timeout: 2000, stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true,
    }).trim()
  } catch {
    return ''
  }
}

function paraSlug(nome: string): string {
  return nome.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
}

function nomeDoRepositorio(cwd: string): string | null {
  const remote = git(['remote', 'get-url', 'origin'], cwd)
  const m = remote.match(/\/([^/]+?)(?:\.git)?$/)
  if (m?.[1]) return m[1]

  const root = git(['rev-parse', '--show-toplevel'], cwd)
  if (!root) return null
  const partes = root.split(/[/\\]/)
  return partes[partes.length - 1] || null
}

/** Grafias a tentar, na mesma ordem de `repo-slug.mjs`: a crua primeiro. */
function candidatosDeSlug(cwd: string): string[] {
  const nome = nomeDoRepositorio(cwd)
  if (!nome) return []
  const slug = paraSlug(nome)
  return slug && slug !== nome ? [nome, slug] : [nome]
}

// ── Registro projectId → caminho, com TTL ───────────────────────────────────────────────────

interface EntradaDoRegistro {
  readonly caminho: string
  readonly ts: number
}

const REGISTRO_FILE = join(tmpdir(), 'rayzen-workdir-registro.json')
const REGISTRO_TTL = 60 * 60 * 1000 // 1h

function lerRegistro(): Record<string, EntradaDoRegistro> {
  try {
    return JSON.parse(readFileSync(REGISTRO_FILE, 'utf8'))
  } catch {
    return {}
  }
}

function gravarNoRegistro(projectId: string, caminho: string): void {
  try {
    const registro = lerRegistro()
    registro[projectId] = { caminho, ts: Date.now() }
    writeFileSync(REGISTRO_FILE, JSON.stringify(registro), 'utf8')
  } catch { /* cache é conveniência — falhar ao gravar não impede a resolução de valer agora */ }
}

/**
 * Varre os diretórios diretamente abaixo de cada raiz de projeto, resolve o repoSlug de cada
 * um, e devolve o primeiro cujo repoSlug bate com o alvo. Não é recursivo: projeto vive um
 * nível abaixo da raiz, por convenção — descer mais fundo acharia `node_modules` e
 * sub-repositórios que não são o que se procura.
 */
function encontrarNoFilesystem(repoSlugAlvo: string): string | null {
  for (const raiz of RAIZES_DE_PROJETO) {
    if (!existsSync(raiz)) continue

    let entradas: string[]
    try {
      entradas = readdirSync(raiz)
    } catch {
      continue
    }

    for (const nome of entradas) {
      const caminho = join(raiz, nome)
      try {
        if (!statSync(caminho).isDirectory()) continue
      } catch {
        continue
      }
      if (candidatosDeSlug(caminho).includes(repoSlugAlvo)) return caminho
    }
  }
  return null
}

// ── Consulta ao Rayzen: projectId → repoSlug ────────────────────────────────────────────────

function buscarRepoSlug(projectId: string): Promise<string | null> {
  const apiUrl = process.env.AGENT_API_URL ?? 'http://localhost:3101'
  const token = process.env.AGENT_TOKEN ?? ''
  if (!token) return Promise.resolve(null)

  return new Promise((resolvePromise) => {
    const parsed = new URL(`${apiUrl}/projects/${projectId}`)
    const isHttps = parsed.protocol === 'https:'
    const lib = isHttps ? httpsRequest : request

    const req = lib({
      hostname: parsed.hostname,
      port: parsed.port || (isHttps ? 443 : 80),
      path: parsed.pathname,
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    }, (res) => {
      let data = ''
      res.on('data', (d) => { data += d })
      res.on('end', () => {
        try {
          const projeto = JSON.parse(data) as { repoSlug?: string }
          resolvePromise(projeto?.repoSlug ?? null)
        } catch {
          resolvePromise(null)
        }
      })
    })

    req.on('error', () => resolvePromise(null))
    req.setTimeout(8000, () => { req.destroy(); resolvePromise(null) })
    req.end()
  })
}

/**
 * O ponto único: `projectId` entra, caminho local absoluto sai — ou `null`. Nunca lança:
 * "não encontrado" é um resultado válido (projeto sem checkout local nesta máquina, ou
 * `repoSlug` não cadastrado), e quem chama decide o que fazer (recusar, por exemplo).
 *
 * Falha fechado por construção: sem `AGENT_TOKEN`, sem resposta da API, ou sem diretório que
 * bata — em todos os casos devolve `null`. Nunca cai de volta em "aceita qualquer caminho".
 */
export async function resolverWorkdir(projectId: string): Promise<string | null> {
  const registro = lerRegistro()
  const emCache = registro[projectId]
  if (emCache && Date.now() - emCache.ts < REGISTRO_TTL && existsSync(emCache.caminho)) {
    return emCache.caminho
  }

  const repoSlug = await buscarRepoSlug(projectId)
  if (!repoSlug) return null

  const caminho = encontrarNoFilesystem(repoSlug)
  if (caminho) gravarNoRegistro(projectId, caminho)
  return caminho
}
