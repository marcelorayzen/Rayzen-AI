import { execFileSync } from 'child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { listarArquivosDoProjeto, lerArquivoDoProjeto, ehSegredo, dentroDoCheckout } from '../arquivos-do-projeto'

jest.setTimeout(60_000)

const ID = ['-c', 'user.email=t@rayzen.local', '-c', 'user.name=t', '-c', 'commit.gpgsign=false']
const git = (cwd: string, args: string[]) => execFileSync('git', [...ID, ...args], { cwd, stdio: 'pipe' })

/** Checkout real: commitado, novo sem commit, .env, .env.example, node_modules ignorado. */
function checkout() {
  const raiz = mkdtempSync(join(tmpdir(), 'rayzen-arquivos-'))
  git(raiz, ['init', '-q', '-b', 'main'])
  mkdirSync(join(raiz, 'src'))
  mkdirSync(join(raiz, 'node_modules', 'lib'), { recursive: true })
  writeFileSync(join(raiz, '.gitignore'), 'node_modules\n')
  writeFileSync(join(raiz, 'README.md'), '# projeto\n')
  writeFileSync(join(raiz, 'src', 'servico.ts'), 'export const x = 1\n')
  writeFileSync(join(raiz, '.env.example'), 'TOKEN=\n')
  git(raiz, ['add', '.'])
  git(raiz, ['commit', '-qm', 'base'])
  writeFileSync(join(raiz, 'src', 'novo.ts'), 'export const y = 2\n')
  writeFileSync(join(raiz, '.env'), 'TOKEN=segredo-real\n')
  writeFileSync(join(raiz, 'node_modules', 'lib', 'index.js'), 'x')
  return raiz
}

describe('arquivos do projeto — o que existe de verdade, sem segredo', () => {
  let raiz: string
  const deps = () => ({ resolver: async () => raiz })
  beforeEach(() => { raiz = checkout() })
  afterEach(() => rmSync(raiz, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }))

  it('lista o repositório respeitando o .gitignore e marcando o que não foi commitado', async () => {
    const r = await listarArquivosDoProjeto({ projectId: 'p1' }, deps())
    const caminhos = r.arquivos.map((a) => a.path)
    expect(caminhos).toEqual(expect.arrayContaining(['README.md', 'src/servico.ts', 'src/novo.ts', '.env.example']))
    expect(caminhos.some((c) => c.startsWith('node_modules'))).toBe(false)
    expect(r.arquivos.find((a) => a.path === 'src/novo.ts')).toMatchObject({ naoCommitado: true })
    expect(r.arquivos.find((a) => a.path === 'src/servico.ts')).not.toHaveProperty('naoCommitado')
  })

  it('o .env não commitado aparece pelo NOME, marcado como segredo', async () => {
    const r = await listarArquivosDoProjeto({ projectId: 'p1' }, deps())
    expect(r.arquivos.find((a) => a.path === '.env')).toMatchObject({ segredo: true })
  })

  it('filtra por subpasta', async () => {
    const r = await listarArquivosDoProjeto({ projectId: 'p1', path: 'src' }, deps())
    expect(r.arquivos.map((a) => a.path).sort()).toEqual(['src/novo.ts', 'src/servico.ts'])
  })

  it('lê um arquivo real, inclusive sem commit', async () => {
    await expect(lerArquivoDoProjeto({ projectId: 'p1', path: 'src/novo.ts' }, deps()))
      .resolves.toMatchObject({ path: 'src/novo.ts', existe: true, conteudo: 'export const y = 2\n' })
  })

  it('arquivo citado que não existe é RESPOSTA, não exceção', async () => {
    await expect(lerArquivoDoProjeto({ projectId: 'p1', path: 'docs/ARCHITECTURE.md' }, deps()))
      .resolves.toEqual({ path: 'docs/ARCHITECTURE.md', existe: false })
  })

  it('nunca devolve o conteúdo do .env', async () => {
    const r = await lerArquivoDoProjeto({ projectId: 'p1', path: '.env' }, deps())
    expect(r).toEqual({ path: '.env', existe: true, recusado: 'segredo' })
    expect(JSON.stringify(r)).not.toContain('segredo-real')
  })

  it('.env.example é template, pode ser lido', async () => {
    await expect(lerArquivoDoProjeto({ projectId: 'p1', path: '.env.example' }, deps()))
      .resolves.toMatchObject({ existe: true, conteudo: 'TOKEN=\n' })
  })

  it.each(['../fora.txt', 'src/../../fora.txt', 'C:/Windows/win.ini', '/etc/passwd'])('recusa sair do checkout: %s', async (path) => {
    await expect(lerArquivoDoProjeto({ projectId: 'p1', path }, deps())).rejects.toThrow(/fora do checkout/)
    await expect(listarArquivosDoProjeto({ projectId: 'p1', path }, deps())).rejects.toThrow(/fora do checkout/)
  })

  it('sem checkout resolvível recusa, sem cair em diretório arbitrário', async () => {
    await expect(listarArquivosDoProjeto({ projectId: 'p1' }, { resolver: async () => null })).rejects.toThrow(/não tem checkout/)
    await expect(lerArquivoDoProjeto({ path: 'README.md' }, deps())).rejects.toThrow(/projectId é obrigatório/)
  })
})

describe('ehSegredo / dentroDoCheckout', () => {
  it.each(['.env', 'apps/api/.env', '.env.local', '.env.production', 'id_rsa', 'certs/server.pem', 'x.key',
    'apps/agent/src/hooks/hook.config.mjs', '.npmrc', '.ssh/config', 'credentials.json'])('%s é segredo', (p) => {
    expect(ehSegredo(p)).toBe(true)
  })
  it.each(['.env.example', '.env.sample', 'README.md', 'src/env.ts', 'docs/keys.md'])('%s não é segredo', (p) => {
    expect(ehSegredo(p)).toBe(false)
  })
  it('normaliza ./ e barra invertida', () => {
    expect(dentroDoCheckout('C:/repo', './src\\a.ts')?.relativo).toBe('src/a.ts')
  })
})
