import { readFileSync } from 'fs'
import { join } from 'path'
import {
  CONTAINER_DA_PREVIA, REDE_DA_PREVIA, VIDA_DA_PREVIA_MS, ambienteSemCredencial, argsDaInstalacao, argsDoServidor,
  avaliarProjeto, iniciarPrevia, lerProjetoParaPrevia, pararPreviaVencida, previaLigada,
} from '../previa-ao-vivo'
import type { Executor } from '../publicar-entrega'

/** Prévia ao vivo (item 3, 17/11): instalar sem credencial, servir sem internet, uma por vez. */

const RAIZ = join(__dirname, '..', '..', '..', '..', '..')
const CADDY = readFileSync(join(RAIZ, 'infra', 'caddy', 'Caddyfile'), 'utf8')
const COMPOSE = readFileSync(join(RAIZ, 'docker-compose.yml'), 'utf8')
const ok = (stdout = '', code = 0, stderr = '') => ({ stdout, stderr, code, timedOut: false })
const PKG_VITE = JSON.stringify({ scripts: { dev: 'vite', build: 'tsc -b && vite build' }, devDependencies: { vite: '^6' } })
const ENV = { AGENT_ROLE: 'server', AGENT_SESSAO_SANDBOX: 'true', PREVIA_URL: 'https://preview.example.com', SANDBOX_WORKSPACES_HOST: '/home/rayzen/workspaces' }

describe('quando liga', () => {
  it('só no servidor, com a sandbox e com um endereço https', () => {
    expect(previaLigada(ENV)).toBe(true)
    expect(previaLigada({ ...ENV, PREVIA_URL: '' })).toBe(false)
    expect(previaLigada({ ...ENV, PREVIA_URL: 'http://preview.example.com' })).toBe(false)
    expect(previaLigada({ ...ENV, AGENT_ROLE: 'desktop' })).toBe(false)
  })
})

describe('o que sabemos servir', () => {
  it('Vite com npm', () => { expect(avaliarProjeto(PKG_VITE, { pnpm: false, yarn: false })).toEqual({ ok: true }) })
  it.each([
    [null, {}, /package.json/],
    [JSON.stringify({ scripts: { build: 'x' } }), {}, /script "dev"/],
    [JSON.stringify({ scripts: { dev: 'next dev' }, dependencies: { next: '1' } }), {}, /não é Vite/],
    [PKG_VITE, { pnpm: true }, /só instala com npm/],
    ['{ quebrado', {}, /JSON válido/],
  ])('recusa dizendo por quê (%#)', (pkg, arq, motivo) => {
    const r = avaliarProjeto(pkg as string | null, { pnpm: false, yarn: false, ...arq })
    expect(r.ok).toBe(false)
    expect((r as { motivo: string }).motivo).toMatch(motivo)
  })
  it('lê o package.json pelo executor da sessão', async () => {
    const executar = jest.fn().mockResolvedValue(ok(`TEM\n${PKG_VITE}`)) as unknown as Executor
    await expect(lerProjetoParaPrevia(executar, '/work/sessao-x')).resolves.toEqual({ ok: true })
    const semPkg = jest.fn().mockResolvedValue(ok('NAO\n')) as unknown as Executor
    await expect(lerProjetoParaPrevia(semPkg, '/work/sessao-x')).resolves.toMatchObject({ ok: false })
  })
})

describe('fronteira', () => {
  it('a instalação vai pelo proxy e NÃO leva credencial nenhuma', () => {
    const a = argsDaInstalacao('/home/rayzen/workspaces/repo', '/work/sessao-x')
    expect(a).toContain('rayzen-sandbox-interna')
    expect(a.join(' ')).toContain('HTTPS_PROXY=http://proxy:8888')
    expect(a).not.toContain('GH_TOKEN')
    expect(a).not.toContain('CLAUDE_CODE_OAUTH_TOKEN')
    expect(a).toEqual(expect.arrayContaining(['--user', '1000:1000', '--cap-drop', 'ALL', 'no-new-privileges:true']))
  })
  it('o ambiente do cliente docker não carrega os tokens da sandbox', () => {
    const env = ambienteSemCredencial({ ...ENV, SANDBOX_GH_TOKEN: 'gh', SANDBOX_CLAUDE_OAUTH_TOKEN: 'cl', PATH: '/usr/bin' })
    expect(Object.values(env)).not.toContain('gh')
    expect(Object.values(env)).not.toContain('cl')
    expect(env.GH_TOKEN).toBeUndefined()
  })
  it('o servidor fica na rede sem saída, sem proxy, com nome fixo e data de início', () => {
    const a = argsDoServidor('/home/rayzen/workspaces/repo', '/work/sessao-x', 123)
    expect(a).toEqual(expect.arrayContaining(['--name', CONTAINER_DA_PREVIA, '--network', REDE_DA_PREVIA, '--label', 'rayzen.previa.inicio=123']))
    expect(a.join(' ')).not.toMatch(/proxy|GH_TOKEN|CLAUDE_CODE/)
    expect(a.slice(-9)).toEqual(['npm', 'run', 'dev', '--', '--host', '0.0.0.0', '--port', '5173', '--strictPort'])
  })
})

describe('iniciar', () => {
  it('derruba a anterior, instala e sobe — nessa ordem', async () => {
    const rodar = jest.fn().mockResolvedValue(ok())
    const r = await iniciarPrevia('rayzen-marcenaria', 'abcdef123456789', { rodar, env: ENV, agora: () => 42 })
    expect(r).toEqual({ ok: true, url: 'https://preview.example.com' })
    const chamadas = rodar.mock.calls.map((c) => (c[1] as string[]).slice(0, 2).join(' '))
    expect(chamadas).toEqual(['rm -f', 'run --rm', 'run -d'])
    expect(rodar.mock.calls[2][1]).toContain('type=bind,src=/home/rayzen/workspaces/rayzen-marcenaria,dst=/work')
    expect(rodar.mock.calls[2][1]).toContain('/work/sessao-abcdef123456')
  })
  it('instalação que falha não sobe servidor e diz o motivo', async () => {
    const rodar = jest.fn()
      .mockResolvedValueOnce(ok())
      .mockResolvedValueOnce(ok('', 1, 'npm ERR! 403'))
    const r = await iniciarPrevia('rayzen-marcenaria', 'abc', { rodar, env: ENV })
    expect(r).toMatchObject({ ok: false, erro: expect.stringContaining('npm ERR! 403') })
    expect(rodar).toHaveBeenCalledTimes(2)
  })
  it('repositório com nome inválido não chega ao docker', async () => {
    const rodar = jest.fn()
    await expect(iniciarPrevia('../etc', 'abc', { rodar, env: ENV })).resolves.toMatchObject({ ok: false })
    expect(rodar).not.toHaveBeenCalled()
  })
})

describe('vida de 2 h', () => {
  const inspect = (inicio: string) => jest.fn().mockResolvedValueOnce(ok(`${inicio}\n`)).mockResolvedValue(ok())
  it('vencida é parada; nova é mantida; sem container, nada', async () => {
    const velha = inspect('1000')
    await expect(pararPreviaVencida(velha, 1000 + VIDA_DA_PREVIA_MS + 1, ENV)).resolves.toBe('parada')
    expect(velha.mock.calls[1][1]).toEqual(['rm', '-f', CONTAINER_DA_PREVIA])
    await expect(pararPreviaVencida(inspect('1000'), 1000 + 60_000, ENV)).resolves.toBe('mantida')
    await expect(pararPreviaVencida(jest.fn().mockResolvedValue(ok('', 1)), 0, ENV)).resolves.toBe('nenhuma')
  })
  it('idade ilegível não é idade velha', async () => {
    const r = inspect('<no value>')
    await expect(pararPreviaVencida(r, Date.now(), ENV)).resolves.toBe('mantida')
    expect(r).toHaveBeenCalledTimes(1)
  })
})

describe('infra', () => {
  it('o Caddy serve a prévia só na porta interna 8081, apontando para o container fixo', () => {
    expect(CADDY).toMatch(/http:\/\/preview\.rayzen\.com\.br:8081 \{/)
    expect(CADDY).not.toMatch(/http:\/\/preview\.rayzen\.com\.br \{/)
    expect(CADDY).toContain(`reverse_proxy ${CONTAINER_DA_PREVIA}:5173`)
  })
  it('o compose não publica a 8081 e põe o Caddy na rede interna da prévia', () => {
    expect(COMPOSE).not.toMatch(/['"]?8081:8081/)
    expect(COMPOSE).toMatch(/networks: \[default, previa\]/)
    expect(COMPOSE).toMatch(/previa:\s*\r?\n\s+name: rayzen-previa\s*\r?\n\s+internal: true/)
  })
})
