import { NOTA_DE_RETOMADA, supervisedSession } from '../supervised-session'
import type { Executor } from '../../exec/publicar-entrega'

/**
 * S3 (16/11/2026) — a sessão no regime sandbox, de ponta a ponta, sem docker: o executor falso
 * faz o papel do container e responde como git/gh/claude responderiam lá dentro. Prova que tudo
 * passa PELO executor (nada roda no host) e que o portão do diff é o mesmo dos outros regimes.
 */

jest.mock('../../exec/sandbox', () => {
  const real = jest.requireActual('../../exec/sandbox')
  return { ...real, repositorioDoProjeto: jest.fn().mockResolvedValue({ dono: 'marcelorayzen', repo: 'rayzen-marcenaria' }) }
})

const SESSAO = 'cmsandbox0001'
const RAMO = 'rayzen/sessao-cmsandbo'

function executorFalso(saidaDoModelo: string | string[] = 'Criei o arquivo.\n[[RAYZEN:DONE]]') {
  const chamadas: { programa: string; args: readonly string[]; cwd: string }[] = []
  const respostas = Array.isArray(saidaDoModelo) ? [...saidaDoModelo] : [saidaDoModelo]
  const executar: Executor = async (programa, args, opts) => {
    chamadas.push({ programa, args, cwd: opts.cwd })
    const ok = (stdout = '') => ({ stdout, stderr: '', code: 0, timedOut: false })
    if (programa === 'claude') {
      const entrada = respostas.shift() ?? ''
      let resultado: Record<string, unknown>
      try {
        const parseado: unknown = JSON.parse(entrada)
        resultado = typeof parseado === 'object' && parseado !== null && !Array.isArray(parseado)
          && (parseado as { type?: unknown }).type === 'result'
          ? parseado as Record<string, unknown>
          : { type: 'result', subtype: 'success', is_error: false, result: entrada }
      } catch {
        resultado = { type: 'result', subtype: 'success', is_error: false, result: entrada }
      }
      const texto = typeof resultado.result === 'string' ? resultado.result : entrada
      const saida = [
        JSON.stringify({ type: 'assistant', message: { content: [
          { type: 'text', text: texto },
          { type: 'tool_use', name: 'Edit', input: { file_path: 'src/example.ts' } },
        ] } }),
        JSON.stringify(resultado),
      ].join('\n') + '\n'
      opts.aoStdout?.(saida.slice(0, 31))
      opts.aoStdout?.(saida.slice(31))
      return ok(saida)
    }
    if (programa === 'bash' && String(args[1]).includes('checkout -q -B')) return ok('base000\n')
    if (programa === 'git' && args[0] === 'remote') return ok('https://github.com/marcelorayzen/rayzen-marcenaria.git')
    if (programa === 'git' && args[0] === 'rev-parse') return ok('head111')
    if (programa === 'git' && args[0] === 'diff') return ok(' SANDBOX.md | 3 +++')
    return ok()
  }
  return { executar, chamadas }
}

function dependencias(sandbox: Executor, resposta = 'Aprovado, publicar') {
  return {
    sandbox,
    postar: jest.fn().mockResolvedValue({ ok: true }),
    consultarStatus: jest.fn().mockResolvedValue('active'),
    pararContainer: jest.fn().mockResolvedValue(undefined),
    aguardarResposta: jest.fn().mockResolvedValue(resposta),
    verificarTestes: jest.fn().mockResolvedValue({
      status: 'não verificado',
      comando: 'não verificado — o projeto não tem script de teste',
      codigo: null,
      duracaoMs: 0,
      ultimasLinhas: [],
    }),
    publicar: jest.fn().mockResolvedValue({
      ok: true,
      entrega: { branch: RAMO, base: 'main', commit: 'c0ffee', commitsAFrente: 1, diffstat: '', remoto: 'x', prUrl: 'https://github.com/marcelorayzen/rayzen-marcenaria/pull/7' },
    }),
  }
}

/**
 * G3.2 (24/11): a continuação de uma sessão interrompida trabalha na pasta e no ramo da ANTIGA.
 * O risco que estes testes guardam: `criarRamoNaSandbox` usa `checkout -B`, que na mesma pasta
 * recriaria o ramo a partir do `main` e apagaria o trabalho salvo.
 */
describe('sessão supervisionada — retomada de uma sessão interrompida (G3.2)', () => {
  const ANTIGA = 'cmantiga0001xyz'
  const NOVA = 'cmnova00002abc'

  function executorDaRetomada(pastaExiste = true) {
    const base = executorFalso()
    const executar: Executor = async (programa, args, opts) => {
      const script = String(args[1] ?? '')
      if (programa === 'bash' && script.includes('[ -d "/work/$1/.git" ]')) {
        base.chamadas.push({ programa, args, cwd: opts.cwd })
        return { stdout: '', stderr: '', code: pastaExiste ? 0 : 1, timedOut: false }
      }
      if (programa === 'bash' && script.includes('merge-base')) {
        base.chamadas.push({ programa, args, cwd: opts.cwd })
        return { stdout: 'merge000\n', stderr: '', code: 0, timedOut: false }
      }
      return base.executar(programa, args, opts)
    }
    return { executar, chamadas: base.chamadas }
  }

  it('trabalha na pasta e no ramo antigos, sem clone novo e sem checkout -B', async () => {
    const { executar, chamadas } = executorDaRetomada()
    const deps = dependencias(executar)
    const r = await supervisedSession(
      { sessionId: NOVA, prompt: 'Acrescente a linha', projectId: 'proj-1', publicar: true, aprovacao: 'por_entrega', retomaDe: ANTIGA },
      deps,
    )
    expect(r).toMatchObject({ ok: true })
    const scripts = chamadas.filter((c) => c.programa === 'bash').map((c) => String(c.args[1]))
    expect(scripts.some((sc) => sc.includes('checkout -q -B'))).toBe(false)
    expect(scripts.some((sc) => sc.includes('git clone'))).toBe(false)
    const retomada = chamadas.find((c) => c.programa === 'bash' && String(c.args[1]).includes('merge-base'))!
    expect(retomada.cwd).toBe('/work/sessao-cmantiga0001')
    expect(retomada.args).toContain('rayzen/sessao-cmantiga')
    // O PR sai do ramo da sessão ANTIGA, onde o trabalho está.
    expect(deps.publicar.mock.calls[0][1]).toBe('rayzen/sessao-cmantiga')
    // A verificação independente roda na pasta antiga.
    expect(deps.verificarTestes.mock.calls[0][2]).toBe(ANTIGA)
    // G2.9: o link do VS Code do cartão "em andamento" aponta para a pasta ANTIGA.
    const link = deps.postar.mock.calls.find(([, corpo]) => corpo && typeof corpo.vscodeUrl === 'string')!
    expect(link[0]).toBe(`/agent/session/${NOVA}/log`)
    expect(link[1].vscodeUrl).toMatch(/^vscode:\/\/vscode-remote\/ssh-remote\+.+\/sessao-cmantiga0001$/)
  })

  it('o modelo recebe a nota de retomada antes do pedido', async () => {
    const { executar, chamadas } = executorDaRetomada()
    await supervisedSession(
      { sessionId: NOVA, prompt: 'Acrescente a linha', projectId: 'proj-1', publicar: true, aprovacao: 'por_entrega', retomaDe: ANTIGA },
      dependencias(executar),
    )
    const modelo = chamadas.find((c) => c.programa === 'claude')!
    const prompt = String(modelo.args[modelo.args.indexOf('-p') + 1])
    expect(prompt.indexOf(NOTA_DE_RETOMADA)).toBeGreaterThan(-1)
    expect(prompt.indexOf(NOTA_DE_RETOMADA)).toBeLessThan(prompt.indexOf('Acrescente a linha'))
  })

  it('a pasta antiga já foi limpa: recusa sem chamar o modelo e sem recriar a pasta', async () => {
    const { executar, chamadas } = executorDaRetomada(false)
    const deps = dependencias(executar)
    const r = await supervisedSession(
      { sessionId: NOVA, prompt: 'x', projectId: 'proj-1', publicar: true, aprovacao: 'por_entrega', retomaDe: ANTIGA },
      deps,
    )
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/não existe mais/) })
    expect(chamadas.some((c) => c.programa === 'claude')).toBe(false)
    // A conferência roda em /work, nunca DENTRO da pasta (o docker -w a recriaria vazia).
    expect(chamadas.every((c) => c.cwd === '/work')).toBe(true)
    expect(deps.postar).toHaveBeenCalledWith(`/agent/session/${NOVA}/error`, expect.anything())
  })

  it('retomaDe com id inválido recusa antes de tocar em qualquer pasta', async () => {
    const { executar, chamadas } = executorDaRetomada()
    const r = await supervisedSession(
      { sessionId: NOVA, prompt: 'x', projectId: 'proj-1', publicar: true, retomaDe: '../../etc' },
      dependencias(executar),
    )
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/id de sessão inválido/) })
    expect(chamadas).toEqual([])
  })
})

describe('sessão supervisionada — regime sandbox', () => {
  // G6, fatia 4: corrigir um PR a partir do ramo dele, e o PR da correção voltar para esse ramo.
  it('baseRef chega à criação do ramo e à publicação', async () => {
    const { executar, chamadas } = executorFalso()
    const deps = dependencias(executar)

    const r = await supervisedSession(
      { sessionId: SESSAO, prompt: 'Corrija o CI', projectId: 'proj-1', publicar: true, aprovacao: 'por_entrega', baseRef: 'feature/pr-7' },
      deps,
    )

    expect(r).toMatchObject({ ok: true })
    const criarRamo = chamadas.find((c) => c.programa === 'bash' && c.args.includes('feature/pr-7'))
    expect(criarRamo?.args[1]).toMatch(/git fetch -q origin/)
    expect(deps.publicar).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.anything(),
      expect.objectContaining({ baseRef: 'feature/pr-7' }))
  })

  it('baseRef inválido recusa a sessão antes de clonar ou chamar o modelo', async () => {
    const { executar, chamadas } = executorFalso()
    const deps = dependencias(executar)

    const r = await supervisedSession(
      { sessionId: SESSAO, prompt: 'x', projectId: 'proj-1', publicar: true, baseRef: '--upload-pack=evil' },
      deps,
    )

    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/ramo de base inválido/) })
    expect(chamadas).toEqual([])
    expect(deps.publicar).not.toHaveBeenCalled()
  })

  it('sem baseRef, a publicação não recebe base nenhuma (comportamento de antes)', async () => {
    const { executar } = executorFalso()
    const deps = dependencias(executar)
    await supervisedSession({ sessionId: SESSAO, prompt: 'x', projectId: 'proj-1', publicar: true, aprovacao: 'por_entrega' }, deps)
    const [, , , opcoes] = deps.publicar.mock.calls[0]
    expect(opcoes).not.toHaveProperty('baseRef')
  })

  it('envia as métricas do Claude para a sessão sem depender do POST para continuar', async () => {
    const etapa = JSON.stringify({
      type: 'result',
      subtype: 'success',
      is_error: false,
      result: 'Primeira etapa.\n[[RAYZEN:STEP_DONE]]',
      total_cost_usd: 0.012,
      num_turns: 2,
      session_id: 'claude-session-1',
      duration_ms: 900,
      modelUsage: { 'claude-sonnet-4-5': { inputTokens: 100, outputTokens: 50 } },
    })
    const conclusao = JSON.stringify({
      type: 'result',
      subtype: 'success',
      is_error: false,
      result: 'Concluído.\n[[RAYZEN:DONE]]',
      total_cost_usd: 0.02,
      num_turns: 3,
      session_id: 'claude-session-2',
      duration_ms: 1200,
      modelUsage: { 'claude-sonnet-4-5': { inputTokens: 200, outputTokens: 100 } },
    })
    const { executar } = executorFalso([etapa, conclusao])
    const deps = dependencias(executar)
    deps.postar.mockImplementation((rota: string) => (
      rota.endsWith('/metrics') ? Promise.reject(new Error('api fora')) : Promise.resolve({ ok: true })
    ))
    deps.aguardarResposta.mockResolvedValue('Aprovado, continue')

    const r = await supervisedSession(
      { sessionId: SESSAO, prompt: 'Crie SANDBOX.md', projectId: 'proj-1', publicar: true },
      deps,
    )

    expect(r).toMatchObject({ ok: true })
    expect(deps.postar.mock.calls.filter(([rota]) => rota.endsWith('/metrics'))).toEqual([
      [`/agent/session/${SESSAO}/metrics`, {
        costUsd: 0.012,
        numTurns: 2,
        modelSessionId: 'claude-session-1',
        papel: 'developer',
        provedor: 'claude-code',
        modelo: 'claude-sonnet-4-5',
      }],
      [`/agent/session/${SESSAO}/metrics`, {
        costUsd: 0.02,
        numTurns: 3,
        modelSessionId: 'claude-session-2',
        papel: 'developer',
        provedor: 'claude-code',
        modelo: 'claude-sonnet-4-5',
      }],
    ])
  })

  it('clona, cria o ramo, roda o modelo e publica tudo PELO executor da sandbox', async () => {
    const { executar, chamadas } = executorFalso()
    const deps = dependencias(executar)
    const r = await supervisedSession(
      { sessionId: SESSAO, prompt: 'Crie SANDBOX.md', projectId: 'proj-1', publicar: true, aprovacao: 'por_entrega' },
      deps,
    )
    expect(r).toMatchObject({ ok: true })

    // O modelo rodou na sandbox, no clone do volume — com o prompt como argumento, não por stdin.
    const modelo = chamadas.find((c) => c.programa === 'claude')!
    expect(modelo.cwd).toBe('/work/sessao-cmsandbox000')
    expect(modelo.args[0]).toBe('-p')
    expect(String(modelo.args[1])).toContain('Crie SANDBOX.md')
    expect(modelo.args).toEqual(expect.arrayContaining(['--output-format', 'stream-json', '--verbose']))

    const logs = deps.postar.mock.calls
      .filter(([rota]) => String(rota).endsWith('/log'))
      .map(([, body]) => (body as { chunk: string }).chunk)
      .join('')
    expect(logs).toContain('💬 Criei o arquivo.')
    expect(logs).toContain('🔧 Edit src/example.ts')

    // Publicar recebeu o executor da sandbox — o push e o PR saem de dentro do container.
    const [base, ramo, , opts] = deps.publicar.mock.calls[0]
    expect(base).toBe('/work/sessao-cmsandbox000')
    expect(ramo).toBe(RAMO)
    expect(opts).toEqual({ executar })

    // Sobras viram commit antes do portão (o volume não é alcançável por ninguém).
    expect(chamadas.some((c) => c.programa === 'bash' && String(c.args[1]).includes('git add -A'))).toBe(true)

    // O resumo final traz o link do PR.
    const complete = deps.postar.mock.calls.find(([rota]) => String(rota).endsWith('/complete'))!
    expect(complete[1].summary).toContain('https://github.com/marcelorayzen/rayzen-marcenaria/pull/7')
  })

  it('o portão do diff é o mesmo: recusado, nada é publicado e isso é dito', async () => {
    const { executar } = executorFalso()
    const deps = dependencias(executar, 'Não publicar')
    await supervisedSession({ sessionId: SESSAO, prompt: 'x', projectId: 'proj-1', publicar: true, aprovacao: 'por_entrega' }, deps)
    expect(deps.publicar).not.toHaveBeenCalled()
    const pergunta = deps.postar.mock.calls.find(([rota, corpo]) => String(rota).endsWith('/question') && corpo.requiresApproval)!
    expect(pergunta[1].question).toContain('SANDBOX.md')
    const complete = deps.postar.mock.calls.find(([rota]) => String(rota).endsWith('/complete'))!
    expect(complete[1].summary).toMatch(/Nada foi publicado.*ficou só no servidor/s)
    // Item 2: o resumo diz onde o trabalho ficou e traz o link que abre no VS Code.
    expect(complete[1].summary).toContain('No servidor: `/home/rayzen/workspaces/rayzen-marcenaria/sessao-cmsandbox000`')
    expect(complete[1].summary).toContain('vscode://vscode-remote/ssh-remote+rayzen@192.0.2.10/home/rayzen/workspaces/rayzen-marcenaria/sessao-cmsandbox000')
  })

  it('parada pedida quando o modelo já terminou vira stopped, não erro', async () => {
    const { executar } = executorFalso()
    const executarModelo = jest.fn(() => new Promise<string>((resolve) => {
      setTimeout(() => resolve('pronto\n[[RAYZEN:DONE]]'), 10)
    }))
    // O container já saiu com o modelo: o stop esgota as tentativas de "no such container".
    const pararContainer = jest.fn(() => new Promise<void>((_resolve, reject) => {
      setTimeout(() => reject(new Error('docker stop não confirmou a parada')), 30)
    }))
    const deps = {
      ...dependencias(executar),
      executarModelo,
      consultarStatus: jest.fn().mockResolvedValue('stopping'),
      pararContainer,
      intervaloParadaMs: 0,
    }

    const resultado = await supervisedSession(
      { sessionId: SESSAO, prompt: 'Crie SANDBOX.md', projectId: 'proj-1', publicar: true },
      deps as never,
    )

    expect(resultado).toMatchObject({ ok: false, status: 'stopped' })
    expect(deps.postar).toHaveBeenCalledWith(`/agent/session/${SESSAO}/stopped`, {})
    expect(deps.publicar).not.toHaveBeenCalled()
  })

  it('interrompe a etapa ativa, marca stopped e não publica nem remove a pasta da sessão', async () => {
    const { executar, chamadas } = executorFalso()
    const executarModelo = jest.fn(() => new Promise<string>((resolve) => {
      setTimeout(() => resolve('não publicar\n[[RAYZEN:DONE]]'), 50)
    }))
    const pararContainer = jest.fn().mockResolvedValue(undefined)
    const deps = {
      ...dependencias(executar),
      executarModelo,
      consultarStatus: jest.fn().mockResolvedValue('stopping'),
      pararContainer,
      intervaloParadaMs: 0,
    }

    const resultado = await supervisedSession(
      { sessionId: SESSAO, prompt: 'Crie SANDBOX.md', projectId: 'proj-1', publicar: true },
      deps as never,
    )

    expect(resultado).toMatchObject({ ok: false, status: 'stopped' })
    expect(pararContainer).toHaveBeenCalledWith(SESSAO)
    expect(deps.postar).toHaveBeenCalledWith(`/agent/session/${SESSAO}/stopped`, {})
    expect(deps.publicar).not.toHaveBeenCalled()
    expect(deps.postar.mock.calls.some(([rota]) => String(rota).endsWith('/complete'))).toBe(false)
    expect(chamadas.some((chamada) => chamada.programa === 'rm')).toBe(false)
  })

  it('sem publicar, recusa antes de clonar — a entrega local se perderia no volume', async () => {
    const { executar, chamadas } = executorFalso()
    const deps = dependencias(executar)
    const r = await supervisedSession({ sessionId: SESSAO, prompt: 'x', projectId: 'proj-1' }, deps)
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/sempre PR/) })
    expect(chamadas).toHaveLength(0)
  })

  it('no agent-server com a sandbox desligada, a sessão é recusada — nunca roda no container do agent', async () => {
    const antes = { role: process.env.AGENT_ROLE, sb: process.env.AGENT_SESSAO_SANDBOX }
    process.env.AGENT_ROLE = 'server'
    delete process.env.AGENT_SESSAO_SANDBOX
    try {
      const postar = jest.fn().mockResolvedValue({ ok: true })
      const r = await supervisedSession({ sessionId: SESSAO, prompt: 'x', projectId: 'proj-1', publicar: true }, { postar })
      expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/sandbox desligada/) })
      expect(postar).toHaveBeenCalledWith(`/agent/session/${SESSAO}/error`, expect.anything())
    } finally {
      if (antes.role === undefined) delete process.env.AGENT_ROLE; else process.env.AGENT_ROLE = antes.role
      if (antes.sb !== undefined) process.env.AGENT_SESSAO_SANDBOX = antes.sb
    }
  })
})

describe('sessão na sandbox — "Aprovado, mesclar" (16/11)', () => {
  function executorComCi(bucket: 'pass' | 'fail') {
    const chamadas: { programa: string; args: readonly string[] }[] = []
    const executar: Executor = async (programa, args) => {
      chamadas.push({ programa, args })
      const ok = (stdout = '') => ({ stdout, stderr: '', code: 0, timedOut: false })
      if (programa === 'claude') return ok('Pronto.\n[[RAYZEN:DONE]]')
      if (programa === 'bash' && String(args[1]).includes('checkout -q -B')) return ok('base000\n')
      if (programa === 'git' && args[0] === 'ls-files') return ok('.github/workflows/quality.yml\n')
      if (programa === 'git' && args[0] === 'remote') return ok('https://github.com/marcelorayzen/rayzen-marcenaria.git')
      if (programa === 'git' && args[0] === 'diff') return ok(' README.md | 3 +++')
      if (programa === 'gh' && args[1] === 'checks') return ok(JSON.stringify([{ name: 'quality', bucket }]))
      if (programa === 'gh' && args[1] === 'view') return ok(JSON.stringify({ state: 'MERGED', mergeCommit: { oid: 'feedface00112233' } }))
      return ok()
    }
    return { executar, chamadas }
  }

  it('com CI, o portão oferece mesclar; CI verde → PR aberto e mesclado, e o resumo diz isso', async () => {
    const { executar, chamadas } = executorComCi('pass')
    const deps = dependencias(executar, 'Aprovado, mesclar')
    await supervisedSession({ sessionId: SESSAO, prompt: 'x', projectId: 'proj-1', publicar: true, aprovacao: 'por_entrega' }, deps)
    const portao = deps.postar.mock.calls.find(([rota, corpo]) => String(rota).endsWith('/question') && corpo.requiresApproval)!
    expect(portao[1].approvalOptions).toEqual(['Aprovado, mesclar', 'Aprovado, só abrir PR', 'Não publicar'])
    expect(deps.publicar).toHaveBeenCalled()
    expect(chamadas.some((c) => c.programa === 'gh' && c.args[1] === 'merge')).toBe(true)
    const complete = deps.postar.mock.calls.find(([rota]) => String(rota).endsWith('/complete'))!
    expect(complete[1].summary).toMatch(/Mesclado no main \(squash\).*feedface0011/s)
  })

  it('CI vermelho: o PR fica aberto, nada é mesclado, e o resumo diz por quê', async () => {
    const { executar, chamadas } = executorComCi('fail')
    const deps = dependencias(executar, 'Aprovado, mesclar')
    await supervisedSession({ sessionId: SESSAO, prompt: 'x', projectId: 'proj-1', publicar: true, aprovacao: 'por_entrega' }, deps)
    expect(chamadas.some((c) => c.programa === 'gh' && c.args[1] === 'merge')).toBe(false)
    const complete = deps.postar.mock.calls.find(([rota]) => String(rota).endsWith('/complete'))!
    expect(complete[1].summary).toMatch(/NÃO mesclei \(ci_falhou.*quality.*O PR continua aberto/s)
  })

  it('"só abrir PR" publica sem mesclar, mesmo com CI', async () => {
    const { executar, chamadas } = executorComCi('pass')
    const deps = dependencias(executar, 'Aprovado, só abrir PR')
    await supervisedSession({ sessionId: SESSAO, prompt: 'x', projectId: 'proj-1', publicar: true, aprovacao: 'por_entrega' }, deps)
    expect(deps.publicar).toHaveBeenCalled()
    expect(chamadas.some((c) => c.programa === 'gh' && c.args[1] === 'checks')).toBe(false)
  })
})

describe('sessão na sandbox — prévia ao vivo no portão do diff (17/11)', () => {
  const PKG = JSON.stringify({ scripts: { dev: 'vite' }, devDependencies: { vite: '^6' } })
  function executorComPkg(pkg: string | null) {
    const base = executorFalso()
    const executar: Executor = async (programa, args, opts) => {
      if (programa === 'bash' && String(args[1]).includes('package.json')) {
        return { stdout: pkg === null ? 'NAO\n' : `TEM\n${pkg}`, stderr: '', code: 0, timedOut: false }
      }
      return base.executar(programa, args, opts)
    }
    return executar
  }

  it('projeto Vite: o link entra na pergunta, a prévia sobe e o resumo traz o endereço', async () => {
    const iniciar = jest.fn().mockResolvedValue({ ok: true, url: 'https://preview.example.com' })
    const deps = { ...dependencias(executorComPkg(PKG), 'Não publicar'), previa: { iniciar, url: 'https://preview.example.com' } }
    await supervisedSession({ sessionId: SESSAO, prompt: 'x', projectId: 'proj-1', publicar: true, aprovacao: 'por_entrega' }, deps)
    expect(iniciar).toHaveBeenCalledWith('rayzen-marcenaria', SESSAO)
    const portao = deps.postar.mock.calls.find(([rota, corpo]) => String(rota).endsWith('/question') && corpo.requiresApproval)!
    expect(portao[1].question).toContain('Prévia ao vivo (sobe em 1–2 min): https://preview.example.com')
    // HC6: a URL vai em campo próprio no portão, para o cartão mostrar o botão antes da decisão.
    expect(portao[1].previewUrl).toBe('https://preview.example.com')
    const complete = deps.postar.mock.calls.find(([rota]) => String(rota).endsWith('/complete'))!
    expect(complete[1].summary).toContain('Prévia ao vivo: https://preview.example.com')
    expect(complete[1].previewUrl).toBe('https://preview.example.com')
  })

  it('projeto que não sabemos servir: nada sobe, e a pergunta diz por quê', async () => {
    const iniciar = jest.fn()
    const deps = { ...dependencias(executorComPkg(null), 'Não publicar'), previa: { iniciar, url: 'https://preview.example.com' } }
    await supervisedSession({ sessionId: SESSAO, prompt: 'x', projectId: 'proj-1', publicar: true, aprovacao: 'por_entrega' }, deps)
    expect(iniciar).not.toHaveBeenCalled()
    const portao = deps.postar.mock.calls.find(([rota, corpo]) => String(rota).endsWith('/question') && corpo.requiresApproval)!
    expect(portao[1].question).toContain('Sem prévia ao vivo: o projeto não tem package.json')
    expect(portao[1]).not.toHaveProperty('previewUrl')
  })

  function executorComArquivos(arquivos: string) {
    const comPkg = executorComPkg(PKG)
    const executar: Executor = async (programa, args, opts) => {
      if (programa === 'git' && args[0] === 'diff' && args[1] === '--name-only') {
        return { stdout: arquivos, stderr: '', code: 0, timedOut: false }
      }
      return comPkg(programa, args, opts)
    }
    return executar
  }

  it('mudança só no README (24/11): nenhuma prévia sobe, e a pergunta manda conferir pelo diff', async () => {
    const iniciar = jest.fn()
    const deps = { ...dependencias(executorComArquivos('README.md\ndocs/guia.md\n'), 'Não publicar'), previa: { iniciar, url: 'https://preview.example.com' } }
    await supervisedSession({ sessionId: SESSAO, prompt: 'x', projectId: 'proj-1', publicar: true, aprovacao: 'por_entrega' }, deps)
    expect(iniciar).not.toHaveBeenCalled()
    const portao = deps.postar.mock.calls.find(([rota, corpo]) => String(rota).endsWith('/question') && corpo.requiresApproval)!
    expect(portao[1].question).toContain('Sem prévia: a mudança só toca documentação')
    expect(portao[1]).not.toHaveProperty('previewUrl')
    const complete = deps.postar.mock.calls.find(([rota]) => String(rota).endsWith('/complete'))!
    expect(complete[1].previewUrl).toBeUndefined()
  })

  it('README junto com código: a prévia continua', async () => {
    const iniciar = jest.fn().mockResolvedValue({ ok: true, url: 'https://preview.example.com' })
    const deps = { ...dependencias(executorComArquivos('README.md\nsrc/App.tsx\n'), 'Não publicar'), previa: { iniciar, url: 'https://preview.example.com' } }
    await supervisedSession({ sessionId: SESSAO, prompt: 'x', projectId: 'proj-1', publicar: true, aprovacao: 'por_entrega' }, deps)
    expect(iniciar).toHaveBeenCalled()
    const portao = deps.postar.mock.calls.find(([rota, corpo]) => String(rota).endsWith('/question') && corpo.requiresApproval)!
    expect(portao[1].previewUrl).toBe('https://preview.example.com')
  })

  it('inclui a verificação independente no portão, no PR e nas métricas da sessão', async () => {
    const { executar } = executorFalso()
    const deps = dependencias(executar)
    const testVerification = {
      status: 'passou',
      comando: 'npm ci --no-audit --no-fund && npm test',
      codigo: 0,
      duracaoMs: 175,
      ultimasLinhas: ['passou'],
    }
    deps.verificarTestes.mockResolvedValue(testVerification)

    await supervisedSession(
      { sessionId: SESSAO, prompt: 'x', projectId: 'proj-1', publicar: true, aprovacao: 'por_entrega' },
      deps,
    )

    const portao = deps.postar.mock.calls.find(([rota, corpo]) => String(rota).endsWith('/question') && corpo.requiresApproval)!
    expect(portao[1].question).toContain('Verificado pelo Rayzen')
    expect(portao[1].question).toContain('npm ci --no-audit --no-fund && npm test')
    expect(portao[1].question).toContain('passou')

    const publicacao = deps.publicar.mock.calls[0]
    expect(publicacao[2].corpo).toContain('Verificado pelo Rayzen')
    expect(publicacao[2].corpo).toContain('passou')
    const complete = deps.postar.mock.calls.find(([rota]) => String(rota).endsWith('/complete'))!
    expect(complete[1].testVerification).toEqual(testVerification)
    expect(deps.verificarTestes).toHaveBeenCalledWith(executar, 'rayzen-marcenaria', SESSAO)
  })

  it('commita o trabalho ANTES de verificar e devolve a árvore ao HEAD depois', async () => {
    const { executar, chamadas } = executorFalso()
    const deps = dependencias(executar)
    let chamadasAntesDaVerificacao = -1
    deps.verificarTestes.mockImplementation(async () => {
      chamadasAntesDaVerificacao = chamadas.length
      return { status: 'passou', comando: 'npm test', codigo: 0, duracaoMs: 1, ultimasLinhas: [] }
    })

    await supervisedSession(
      { sessionId: SESSAO, prompt: 'x', projectId: 'proj-1', publicar: true, aprovacao: 'por_entrega' },
      deps,
    )

    const indice = (trecho: string) => chamadas.findIndex((c) => c.programa === 'bash' && String(c.args[1]).includes(trecho))
    const commit = indice('git add -A')
    const restauracao = indice('git reset -q --hard HEAD')
    expect(commit).toBeGreaterThanOrEqual(0)
    expect(commit).toBeLessThan(chamadasAntesDaVerificacao)
    expect(restauracao).toBeGreaterThanOrEqual(chamadasAntesDaVerificacao)
  })
})

describe('sessão na sandbox — link do VS Code durante a sessão (G2.9)', () => {
  it('manda o link da pasta da sessão assim que ela fica pronta, antes do modelo trabalhar', async () => {
    const { executar } = executorFalso()
    const deps = dependencias(executar)
    await supervisedSession({ sessionId: SESSAO, prompt: 'x', projectId: 'proj-1', publicar: true, aprovacao: 'por_entrega' }, deps)
    const chamadas = deps.postar.mock.calls
    const iLink = chamadas.findIndex(([, corpo]) => corpo && typeof corpo.vscodeUrl === 'string')
    expect(iLink).toBeGreaterThanOrEqual(0)
    expect(chamadas[iLink][1].vscodeUrl).toMatch(/\/sessao-cmsandbox000$/)
    // Antes de qualquer pergunta ou conclusão da sessão.
    const iPrimeiraPergunta = chamadas.findIndex(([rota]) => String(rota).endsWith('/question') || String(rota).endsWith('/complete'))
    expect(iLink).toBeLessThan(iPrimeiraPergunta)
  })
})
