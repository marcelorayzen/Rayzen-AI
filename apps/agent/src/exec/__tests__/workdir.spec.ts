import { execFileSync } from 'child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'fs'
import { createServer, type Server } from 'http'
import { join } from 'path'
import { resolverWorkdir } from '../workdir'

/**
 * Fase 3 — `resolverWorkdir()`: `projectId` entra, caminho local sai. Nunca aceita caminho
 * livre — quem chama não pode inventar um diretório, só pedir por identidade.
 *
 * A resolução de repoSlug está DUPLICADA de `repo-slug.mjs` (ver o comentário no topo de
 * `workdir.ts` — `.ts` CommonJS não `require()` `.mjs` ESM de forma síncrona). O anti-drift
 * aqui é COMPORTAMENTAL, não textual: um servidor de mentira representa o Rayzen dizendo
 * "esse projectId tem este repoSlug" — o repoSlug vem do `.mjs` DE VERDADE, rodado num
 * subprocesso Node (mesma técnica de `repo-slug.spec.ts`) contra um repositório real. Se a
 * duplicação em `workdir.ts` divergir da original, `resolverWorkdir` simplesmente não acha o
 * diretório — o teste falha pelo sintoma real, não por comparação de texto de função.
 */
const REPO_SLUG_MJS = join(__dirname, '..', '..', 'repo-slug.mjs').replace(/\\/g, '/')

/** `candidatosDeSlug` do `.mjs` de verdade, rodado num processo Node separado. */
function candidatosDeSlugReal(cwd: string): string[] {
  const saida = execFileSync(
    process.execPath,
    ['--input-type=module', '-e', `import { candidatosDeSlug } from 'file:///${REPO_SLUG_MJS}'
       console.log(JSON.stringify(candidatosDeSlug(${JSON.stringify(cwd)})))`],
    { encoding: 'utf8', timeout: 15000 },
  ).trim()
  return JSON.parse(saida)
}

function repoTemporario(nomeRemoto: string): string {
  const base = join(process.env.USERPROFILE ?? process.env.HOME ?? '', 'Projects')
  // No runner do CI (Linux, $HOME=/home/runner) esta pasta não existe por padrão.
  mkdirSync(base, { recursive: true })
  const dir = mkdtempSync(join(base, 'rayzen-workdir-teste-'))
  execFileSync('git', ['init', '-q'], { cwd: dir })
  execFileSync('git', ['remote', 'add', 'origin', `https://github.com/x/${nomeRemoto}.git`], { cwd: dir })
  return dir
}

/** Servidor de mentira: representa `GET /projects/:id` do Rayzen devolvendo um repoSlug fixo. */
function subirApiDeMentira(repoSlug: string | null): Promise<{ url: string; fechar: () => Promise<void> }> {
  return new Promise((resolvePromise) => {
    const server: Server = createServer((_req, res) => {
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify(repoSlug ? { repoSlug } : {}))
    })
    server.listen(0, '127.0.0.1', () => {
      const endereco = server.address()
      const porta = typeof endereco === 'object' && endereco ? endereco.port : 0
      resolvePromise({
        url: `http://127.0.0.1:${porta}`,
        fechar: () => new Promise((r) => server.close(() => r())),
      })
    })
  })
}

describe('resolverWorkdir — comportamento fim a fim, contra o repoSlug real do .mjs', () => {
  const envOriginal = { ...process.env }
  afterEach(() => {
    process.env.AGENT_API_URL = envOriginal.AGENT_API_URL
    process.env.AGENT_TOKEN = envOriginal.AGENT_TOKEN
  })

  it.each([
    ['nome kebab já pronto', 'banco-imob'],
    ['nome com maiúsculas — Rayzen-PDV não pode virar rayzen-pdv', 'Rayzen-PDV'],
  ])('%s: acha o diretório certo usando o MESMO repoSlug que repo-slug.mjs calcularia', async (_rotulo, nomeRemoto) => {
    const repo = repoTemporario(nomeRemoto)
    // A verdade fundamental: o que o .mjs de produção diria para este diretório.
    const [repoSlugReal] = candidatosDeSlugReal(repo)
    expect(repoSlugReal).toBe(nomeRemoto) // crua primeiro — confirma a premissa do teste

    const api = await subirApiDeMentira(repoSlugReal)
    process.env.AGENT_API_URL = api.url
    process.env.AGENT_TOKEN = 'token-de-teste'
    try {
      const caminho = await resolverWorkdir('11111111-1111-1111-1111-111111111111')
      expect(caminho).toBe(repo)
    } finally {
      await api.fechar()
      rmSync(repo, { recursive: true, force: true })
    }
  }, 20_000)

  it('repoSlug que não existe em disco devolve null — nunca chuta o primeiro diretório que achar', async () => {
    const api = await subirApiDeMentira('projeto-que-nao-existe-em-lugar-nenhum-9f7')
    process.env.AGENT_API_URL = api.url
    process.env.AGENT_TOKEN = 'token-de-teste'
    try {
      await expect(resolverWorkdir('22222222-2222-2222-2222-222222222222')).resolves.toBeNull()
    } finally {
      await api.fechar()
    }
  })

  it('API sem repoSlug (projeto sem cadastro) devolve null', async () => {
    const api = await subirApiDeMentira(null)
    process.env.AGENT_API_URL = api.url
    process.env.AGENT_TOKEN = 'token-de-teste'
    try {
      await expect(resolverWorkdir('33333333-3333-3333-3333-333333333333')).resolves.toBeNull()
    } finally {
      await api.fechar()
    }
  })

  it('sem AGENT_TOKEN, devolve null — nunca cai para caminho livre', async () => {
    delete process.env.AGENT_TOKEN
    await expect(resolverWorkdir('qualquer-id')).resolves.toBeNull()
  })

  it('API inalcançável devolve null, não lança', async () => {
    process.env.AGENT_API_URL = 'http://127.0.0.1:1' // porta que nada escuta — falha rápido
    process.env.AGENT_TOKEN = 'token-de-teste'
    await expect(resolverWorkdir('44444444-4444-4444-4444-444444444444')).resolves.toBeNull()
  }, 15_000)
})

describe('workdir.ts — não reintroduz caminho livre', () => {
  const fonte = readFileSync(join(__dirname, '..', 'workdir.ts'), 'utf8')

  it('a única função exportada é resolverWorkdir — projectId é a única entrada pública', () => {
    const exportadas = [...fonte.matchAll(/^export (?:async )?function (\w+)/gm)].map((m) => m[1])
    expect(exportadas).toEqual(['resolverWorkdir'])
  })

  it('não aceita path/caminho como parâmetro de resolverWorkdir', () => {
    const assinatura = fonte.match(/export async function resolverWorkdir\(([^)]*)\)/)?.[1] ?? ''
    expect(assinatura).not.toMatch(/path|caminho/i)
    expect(assinatura).toMatch(/projectId/)
  })
})
