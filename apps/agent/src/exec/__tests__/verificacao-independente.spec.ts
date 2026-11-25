import { verificarTestesIndependentes } from '../verificacao-independente'
import type { Executor } from '../publicar-entrega'

const ok = (stdout = '', code = 0, stderr = '', timedOut = false) => ({ stdout, stderr, code, timedOut })

function executorDoPackageJson(packageJson: string) {
  const executar: Executor = jest.fn().mockResolvedValue(ok(packageJson))
  return executar
}

describe('verificação independente da sessão', () => {
  it('roda npm ci e npm test em container sem credenciais, registrando sucesso e saída', async () => {
    const executar = executorDoPackageJson(JSON.stringify({ scripts: { test: 'jest' } }))
    const rodar = jest.fn().mockResolvedValue(ok('instalou\npassou\n', 0))
    const resultado = await verificarTestesIndependentes(executar, 'rayzen-marcenaria', 'sessao-123', {
      rodar,
      env: {
        PATH: '/usr/bin',
        SANDBOX_GH_TOKEN: 'segredo-gh',
        SANDBOX_CLAUDE_OAUTH_TOKEN: 'segredo-claude',
      },
      agora: jest.fn().mockReturnValueOnce(100).mockReturnValueOnce(275),
    })

    expect(resultado).toEqual({
      status: 'passou',
      comando: 'npm ci --no-audit --no-fund && npm test',
      codigo: 0,
      duracaoMs: 175,
      ultimasLinhas: ['instalou', 'passou'],
    })
    expect(rodar).toHaveBeenCalledWith(
      'docker',
      expect.arrayContaining(['rayzen-sandbox-interna', 'npm ci --no-audit --no-fund && npm test']),
      expect.objectContaining({ timeoutMs: 10 * 60 * 1000 }),
    )
    expect(rodar.mock.calls[0][2].env).not.toHaveProperty('SANDBOX_GH_TOKEN')
    expect(rodar.mock.calls[0][2].env).not.toHaveProperty('SANDBOX_CLAUDE_OAUTH_TOKEN')
  })

  it('registra falha do teste sem impedir o restante do fluxo', async () => {
    const executar = executorDoPackageJson(JSON.stringify({ scripts: { test: 'jest' } }))
    const rodar = jest.fn().mockResolvedValue(ok('falhou\n', 1))

    await expect(verificarTestesIndependentes(executar, 'repo', 'sessao', { rodar }))
      .resolves.toMatchObject({
        status: 'falhou',
        comando: 'npm ci --no-audit --no-fund && npm test',
        codigo: 1,
        ultimasLinhas: ['falhou'],
      })
  })

  it('sem scripts.test retorna não verificado sem iniciar container', async () => {
    const executar = executorDoPackageJson(JSON.stringify({ scripts: { build: 'vite build' } }))
    const rodar = jest.fn()

    await expect(verificarTestesIndependentes(executar, 'repo', 'sessao', { rodar }))
      .resolves.toEqual({
        status: 'não verificado',
        comando: 'não verificado — o projeto não tem script de teste',
        codigo: null,
        duracaoMs: 0,
        ultimasLinhas: [],
      })
    expect(rodar).not.toHaveBeenCalled()
  })

  it('timeout registra que não terminou em 10 min e as últimas 40 linhas', async () => {
    const executar = executorDoPackageJson(JSON.stringify({ scripts: { test: 'jest' } }))
    const linhas = Array.from({ length: 45 }, (_, i) => `linha ${i + 1}`)
    const rodar = jest.fn().mockResolvedValue(ok(linhas.join('\n'), 1, '', true))

    await expect(verificarTestesIndependentes(executar, 'repo', 'sessao', { rodar }))
      .resolves.toMatchObject({
        status: 'timeout',
        comando: 'npm ci --no-audit --no-fund && npm test',
        codigo: null,
        ultimasLinhas: linhas.slice(-40),
      })
  })
})
