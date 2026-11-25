import { dentroDoEspelho, espelhoDoProjeto, leituraNoServidorLigada, lerNoServidor, listarNoServidor, type Espelho } from '../leitura-no-servidor'
import type { Executor } from '../publicar-entrega'

/** Leitura pelo servidor (17/11): as mesmas travas da leitura do PC, outra origem. */

const ok = (stdout = '', code = 0) => ({ stdout, stderr: '', code, timedOut: false })
const espelho = (executar: Executor): Espelho => ({ executar, fonte: 'servidor — ramo padrão de github.com/x/y' })

describe('caminho dentro do espelho', () => {
  it.each([
    ['README.md', 'README.md'], ['./src/a.ts', 'src/a.ts'], ['src\\b.ts', 'src/b.ts'], ['', ''],
  ])('"%s" → "%s"', (pedido, esperado) => { expect(dentroDoEspelho(pedido)).toBe(esperado) })
  it.each(['../fora', '/etc/passwd', 'C:/x', 'src/../../fora'])('"%s" sai do espelho → recusado', (pedido) => {
    expect(dentroDoEspelho(pedido)).toBeNull()
  })
})

describe('ler', () => {
  it('segredo é recusado ANTES de qualquer container — nem a existência é consultada', async () => {
    const executar = jest.fn() as unknown as Executor
    await expect(lerNoServidor({ projectId: 'p', path: '.env' }, espelho(executar))).resolves.toEqual({ path: '.env', recusado: 'segredo' })
    expect(executar).not.toHaveBeenCalled()
  })
  it('o caminho vai como argumento posicional, nunca dentro do script', async () => {
    const executar = jest.fn().mockResolvedValue(ok('TEXTO 5\nola\n')) as unknown as jest.MockedFunction<Executor>
    const r = await lerNoServidor({ projectId: 'p', path: 'docs/a;rm -rf.md' }, espelho(executar))
    const [programa, args] = executar.mock.calls[0]
    expect(programa).toBe('bash')
    expect(args[1]).not.toContain('rm -rf')
    expect(args.slice(-2)).toEqual(['_', 'docs/a;rm -rf.md'])
    expect(r).toMatchObject({ existe: true, bytes: 5, conteudo: 'ola\n', truncado: false, fonte: expect.stringContaining('servidor') })
  })
  it.each([
    ['NAOEXISTE\n', { existe: false }],
    ['DIRETORIO\n', { existe: true, diretorio: true }],
    ['BINARIO 9000\n', { existe: true, binario: true, bytes: 9000 }],
  ])('cabeçalho %j', async (saida, esperado) => {
    const executar = jest.fn().mockResolvedValue(ok(saida)) as unknown as Executor
    await expect(lerNoServidor({ projectId: 'p', path: 'x' }, espelho(executar))).resolves.toMatchObject(esperado)
  })
  it('arquivo maior que o limite vem marcado como truncado', async () => {
    const executar = jest.fn().mockResolvedValue(ok(`TEXTO ${300 * 1024}\nconteudo`)) as unknown as Executor
    await expect(lerNoServidor({ projectId: 'p', path: 'grande.txt' }, espelho(executar))).resolves.toMatchObject({ truncado: true })
  })
  it('caminho fora do espelho nem chega ao container', async () => {
    const executar = jest.fn() as unknown as Executor
    await expect(lerNoServidor({ projectId: 'p', path: '../../etc/passwd' }, espelho(executar))).rejects.toThrow(/fora do checkout/)
    expect(executar).not.toHaveBeenCalled()
  })
})

describe('listar', () => {
  it('filtra pelo prefixo, marca segredo e diz a fonte', async () => {
    const executar = jest.fn().mockResolvedValue(ok('README.md\nsrc/a.ts\nsrc/b.ts\n.env\n')) as unknown as Executor
    const r = await listarNoServidor({ projectId: 'p', path: 'src' }, espelho(executar))
    expect(r.arquivos.map((a) => a.path)).toEqual(['src/a.ts', 'src/b.ts'])
    const todos = await listarNoServidor({ projectId: 'p' }, espelho(executar))
    expect(todos.arquivos.find((a) => a.path === '.env')).toEqual({ path: '.env', segredo: true })
    expect(todos.fonte).toMatch(/servidor/)
  })
})

describe('espelho', () => {
  it('o primeiro clone já usa o gh como credencial (repositório privado, 23/11)', async () => {
    const executar = jest.fn().mockResolvedValue(ok()) as unknown as jest.MockedFunction<Executor>
    await espelhoDoProjeto('p', {
      repositorio: async () => ({ dono: 'marcelorayzen', repo: 'repo-privado' }),
      garantirPasta: async () => ({ ok: true as const, pasta: '/home/rayzen/workspaces/repo-privado' }),
      executorPara: () => executar,
      agora: () => 9_000_000_000,
    })
    const script = executar.mock.calls[0][1][1]
    const linhaDoClone = script.split('\n').find((l) => / clone /.test(l))
    expect(linhaDoClone).toContain(`-c credential.helper='!gh auth git-credential' clone`)
  })

  it('atualiza do GitHub no máximo uma vez por minuto', async () => {
    const executar = jest.fn().mockResolvedValue(ok()) as unknown as jest.MockedFunction<Executor>
    let agora = 1_000_000
    const deps = {
      repositorio: async () => ({ dono: 'marcelorayzen', repo: 'repo-espelho' }),
      garantirPasta: async () => ({ ok: true as const, pasta: '/home/rayzen/workspaces/repo-espelho' }),
      executorPara: () => executar,
      agora: () => agora,
    }
    await espelhoDoProjeto('p', deps)
    await espelhoDoProjeto('p', deps)
    expect(executar).toHaveBeenCalledTimes(1)
    agora += 61_000
    await espelhoDoProjeto('p', deps)
    expect(executar).toHaveBeenCalledTimes(2)
    // Dono e repo viajam como argumentos posicionais.
    expect(executar.mock.calls[0][1].slice(-3)).toEqual(['_', 'marcelorayzen', 'repo-espelho'])
  })
  it('liga só no servidor com a sandbox e com a chave explícita', () => {
    expect(leituraNoServidorLigada({ AGENT_ROLE: 'server', AGENT_SESSAO_SANDBOX: 'true', AGENT_LEITURA_NO_SERVIDOR: 'true' })).toBe(true)
    expect(leituraNoServidorLigada({ AGENT_ROLE: 'server', AGENT_SESSAO_SANDBOX: 'true' })).toBe(false)
    expect(leituraNoServidorLigada({ AGENT_ROLE: 'desktop', AGENT_SESSAO_SANDBOX: 'true', AGENT_LEITURA_NO_SERVIDOR: 'true' })).toBe(false)
  })
})
