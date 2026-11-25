import {
  apagarPastaDeSessao, deveApagar, estadoDoPr, limparUmaVez, listarPastasDeSessao, ramoDaPasta,
} from '../limpeza-de-workspaces'

/** Limpeza de ~/workspaces (17/11): após merge, PR fechado ou 24 h sem PR; nunca no escuro. */

const HORA = 60 * 60 * 1000
const ok = (stdout = '', stderr = '', code = 0) => ({ stdout, stderr, code, timedOut: false })

describe('regra de apagar', () => {
  it.each([
    ['MERGED', 1, true], ['CLOSED', 1, true],
    ['NENHUM', 25 * HORA, true], ['NENHUM', 2 * HORA, false],
    ['OPEN', 100 * HORA, false],
    // Sem medir, não apaga — nem pasta velha.
    ['INCONCLUSIVO', 100 * HORA, false],
  ] as const)('%s com %s ms → apagar=%s', (estado, idade, esperado) => {
    expect(deveApagar(estado, idade)).toBe(esperado)
  })

  it('o ramo vem da pasta, com os 8 caracteres de branchDaSessao', () => {
    expect(ramoDaPasta('sessao-cmwk15xy4000')).toBe('rayzen/sessao-cmwk15xy')
  })
})

describe('listar', () => {
  it('só aceita repo/sessao-[a-z0-9] — qualquer outra coisa é ignorada', async () => {
    const rodar = jest.fn().mockResolvedValue(ok([
      'rayzen-marcenaria/sessao-cmwk15xy4000 1794880000.5',
      'rayzen-marcenaria/node_modules 1794880000',
      '../etc/sessao-x 1794880000',
      'outro/sessao-ABC 1794880000',
    ].join('\n')))
    const lista = await listarPastasDeSessao(rodar, { PATH: '/bin' })
    expect(lista).toEqual([{ repo: 'rayzen-marcenaria', pasta: 'sessao-cmwk15xy4000', modificadaEm: 1794880000500 }])
    const argv: string[] = rodar.mock.calls[0][1]
    expect(argv[argv.indexOf('--network') + 1]).toBe('none')
  })
})

describe('estado do PR', () => {
  const p = { repo: 'r', pasta: 'sessao-abc12345xyz', modificadaEm: 0 }
  it('MERGED/CLOSED/OPEN vêm do gh', async () => {
    await expect(estadoDoPr(p, jest.fn().mockResolvedValue(ok('MERGED\n')))).resolves.toBe('MERGED')
  })
  it('"no pull requests found" é resposta: NENHUM', async () => {
    await expect(estadoDoPr(p, jest.fn().mockResolvedValue(ok('', 'no pull requests found for branch "x"', 1)))).resolves.toBe('NENHUM')
  })
  it('qualquer outra falha é INCONCLUSIVO, nunca NENHUM', async () => {
    await expect(estadoDoPr(p, jest.fn().mockResolvedValue(ok('', 'HTTP 502', 1)))).resolves.toBe('INCONCLUSIVO')
  })
})

describe('apagar', () => {
  it('container sem rede, só a pasta do projeto montada, rm só da subpasta da sessão', async () => {
    const rodar = jest.fn().mockResolvedValue(ok())
    await expect(apagarPastaDeSessao('rayzen-marcenaria', 'sessao-abc', rodar, {})).resolves.toBe(true)
    const argv: string[] = rodar.mock.calls[0][1]
    expect(argv).toContain('type=bind,src=/home/rayzen/workspaces/rayzen-marcenaria,dst=/work')
    expect(argv.slice(-4)).toEqual(['rm', '-rf', '--', '/work/sessao-abc'])
    expect(argv[argv.indexOf('--network') + 1]).toBe('none')
  })
  it.each([['..', 'sessao-a'], ['r', '..'], ['r', 'sessao-a/../..'], ['r', 'node_modules'], ['r', '']])(
    'nome fora do padrão (%s, %s) nem chega ao docker', async (repo, pasta) => {
      const rodar = jest.fn()
      await expect(apagarPastaDeSessao(repo, pasta, rodar, {})).resolves.toBe(false)
      expect(rodar).not.toHaveBeenCalled()
    })
})

describe('uma rodada', () => {
  it('apaga o mesclado e o sem PR velho; mantém o aberto e o inconclusivo', async () => {
    const agora = 1_800_000_000_000
    const pastas = [
      { repo: 'r', pasta: 'sessao-mesclada', modificadaEm: agora - HORA },
      { repo: 'r', pasta: 'sessao-aberta', modificadaEm: agora - 100 * HORA },
      { repo: 'r', pasta: 'sessao-semprvelha', modificadaEm: agora - 30 * HORA },
      { repo: 'r', pasta: 'sessao-semprnova', modificadaEm: agora - HORA },
      { repo: 'r', pasta: 'sessao-semgithub', modificadaEm: agora - 100 * HORA },
    ]
    const estados: Record<string, string> = {
      'sessao-mesclada': 'MERGED', 'sessao-aberta': 'OPEN', 'sessao-semprvelha': 'NENHUM',
      'sessao-semprnova': 'NENHUM', 'sessao-semgithub': 'INCONCLUSIVO',
    }
    const apagar = jest.fn().mockResolvedValue(true)
    const r = await limparUmaVez(agora, {
      listar: async () => pastas,
      estado: async (p) => estados[p.pasta] as never,
      apagar,
    })
    expect(apagar.mock.calls.map((c) => c[1]).sort()).toEqual(['sessao-mesclada', 'sessao-semprvelha'])
    expect(r).toMatchObject({ vistas: 5, mantidas: 3, inconclusivas: 1 })
  })
})
