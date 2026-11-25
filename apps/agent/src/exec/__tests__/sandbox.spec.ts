import { readFileSync } from 'fs'
import { join } from 'path'
import {
  ambienteDoDocker, argsDoDockerRun, executorDaSandbox, garantirPastaDoProjeto, lerResultadoDoClaude,
  linhaDeProgresso,
  linkDoVscode, modeloNaSandbox, nomeDoContainerDaSessao, pastaDaSessao, pastaDoProjetoNoHost, pararContainerDaSessao, prepararCloneNaSandbox,
  regimeSandboxLigado, repositorioDoProjeto, criarRamoNaSandbox, refDeBaseValida, mudancaSoDeDocumentacao, arquivosAlteradosNaSandbox,
} from '../sandbox'
import type { Executor } from '../publicar-entrega'

/** S3 (16/11/2026) — o regime sandbox da sessão: a fronteira e o que atravessa ela. */

const SCRIPT = readFileSync(join(__dirname, '..', '..', '..', '..', '..', 'infra', 'sandbox', 'rodar-na-sandbox.sh'), 'utf8')

describe('fronteira da sandbox — igual à do script provado', () => {
  const args = argsDoDockerRun('/home/rayzen/workspaces/repo', '/work/sessao-x')

  // `verificar-sandbox.sh` provou 11/11 com as flags do script. Se o código divergir, a sessão
  // rodaria numa fronteira que ninguém provou — sem erro nenhum.
  it.each([
    ['--user', '1000:1000'], ['--cap-drop', 'ALL'], ['--security-opt', 'no-new-privileges:true'],
    ['--memory', '3g'], ['--memory-swap', '3g'], ['--cpus', '2'], ['--pids-limit', '512'],
    ['--network', 'rayzen-sandbox-interna'],
  ])('%s %s está no código e no script', (flag, valor) => {
    const i = args.indexOf(flag)
    expect(i).toBeGreaterThan(-1)
    expect(args[i + 1]).toBe(valor)
    expect(SCRIPT).toMatch(new RegExp(`${flag.replace(/-/g, '\\-')}[ =]${valor.replace(/[.:]/g, '\\$&')}\\b`))
  })

  it('nunca monta o socket do docker; o único bind é a pasta do projeto em /work (item 2)', () => {
    const tudo = args.join(' ')
    expect(tudo).not.toMatch(/docker\.sock/)
    expect(tudo).not.toMatch(/-v \//)
    expect(args.filter((a) => a.startsWith('type='))).toEqual(['type=bind,src=/home/rayzen/workspaces/repo,dst=/work'])
  })

  it('credenciais por NOME — o valor nunca aparece no argv', () => {
    expect(args).toEqual(expect.arrayContaining(['-e', 'GH_TOKEN', '-e', 'CLAUDE_CODE_OAUTH_TOKEN']))
    expect(args.join(' ')).not.toMatch(/GH_TOKEN=|CLAUDE_CODE_OAUTH_TOKEN=/)
  })

  it('o ambiente do cliente docker leva as credenciais da SANDBOX, não as do agent', () => {
    const env = ambienteDoDocker({
      PATH: '/bin', HOME: '/home/x', SANDBOX_GH_TOKEN: 'gh-sandbox', SANDBOX_CLAUDE_OAUTH_TOKEN: 'cl-sandbox',
      AGENT_TOKEN: 'segredo-do-agent', GH_TOKEN: 'gh-do-dono',
    })
    expect(env.GH_TOKEN).toBe('gh-sandbox')
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe('cl-sandbox')
    expect(env.AGENT_TOKEN).toBeUndefined()
  })
})

describe('executor da sandbox', () => {
  it('vira docker run com o programa depois da imagem, sem shell', async () => {
    const rodar = jest.fn().mockResolvedValue({ stdout: 'ok', stderr: '', code: 0, timedOut: false })
    const aoStdout = jest.fn()
    const executar = executorDaSandbox('/home/rayzen/workspaces/r', rodar)
    await executar('git', ['status', '--short'], { cwd: '/work/r', env: { QUALQUER: 'x' }, timeoutMs: 1000, aoStdout })
    const [programa, argv, opts] = rodar.mock.calls[0]
    expect(programa).toBe('docker')
    expect(argv.slice(-4)).toEqual(['rayzen-sandbox', 'git', 'status', '--short'])
    expect(argv[argv.indexOf('-w') + 1]).toBe('/work/r')
    expect(opts.aoStdout).toBe(aoStdout)
    // O env pedido pelo chamador não entra no container: vale só o da fronteira.
    expect(opts.env.QUALQUER).toBeUndefined()
  })

  it('nomeia apenas o container do modelo pelo id curto da sessão', async () => {
    const rodar = jest.fn().mockResolvedValue({ stdout: 'ok', stderr: '', code: 0, timedOut: false })
    const executar = executorDaSandbox('/home/rayzen/workspaces/r', rodar, 'cmsandbox0001')

    await executar('claude', ['-p', 'faça'], { cwd: '/work/sessao-x', env: {}, timeoutMs: 1000 })
    await executar('git', ['status'], { cwd: '/work/sessao-x', env: {}, timeoutMs: 1000 })

    const [, argsModelo] = rodar.mock.calls[0]
    expect(argsModelo.slice(argsModelo.indexOf('--name'), argsModelo.indexOf('--name') + 2))
      .toEqual(['--name', 'rayzen-sessao-cmsandbox000'])
    expect(rodar.mock.calls[1][1]).not.toContain('--name')
  })

  it('usa o mesmo prefixo do container no script operacional', () => {
    expect(nomeDoContainerDaSessao('cmsandbox0001')).toBe('rayzen-sessao-cmsandbox000')
    expect(SCRIPT).toContain('--name "rayzen-sessao-$SHORT_ID"')
  })

  it('para o container pelo executável docker com o mesmo nome e shell false', async () => {
    const rodar = jest.fn().mockResolvedValue({ stdout: 'rayzen-sessao-cmsandbox000', stderr: '', code: 0, timedOut: false })
    const anteriores = {
      HOME: process.env.HOME,
      DOCKER_HOST: process.env.DOCKER_HOST,
      SANDBOX_GH_TOKEN: process.env.SANDBOX_GH_TOKEN,
    }
    process.env.HOME = '/home/agent'
    process.env.DOCKER_HOST = 'tcp://docker-daemon:2376'
    process.env.SANDBOX_GH_TOKEN = 'sandbox-token'

    try {
      await pararContainerDaSessao('cmsandbox0001', rodar)

      expect(rodar).toHaveBeenCalledWith(
        'docker',
        ['stop', '-t', '10', 'rayzen-sessao-cmsandbox000'],
        expect.objectContaining({ cwd: process.cwd(), timeoutMs: 20_000 }),
      )
      const { env } = rodar.mock.calls[0][2]
      expect(env.HOME).toBe('/home/agent')
      expect(env.DOCKER_HOST).toBe('tcp://docker-daemon:2376')
      expect(env.SANDBOX_GH_TOKEN).toBeUndefined()
    } finally {
      for (const [chave, valor] of Object.entries(anteriores)) {
        if (valor === undefined) delete process.env[chave]
        else process.env[chave] = valor
      }
    }
  })

  it('espera o container nomeado aparecer antes de concluir uma parada solicitada cedo', async () => {
    const rodar = jest.fn()
      .mockResolvedValueOnce({ stdout: '', stderr: 'No such container: rayzen-sessao-cmsandbox000', code: 1, timedOut: false })
      .mockResolvedValueOnce({ stdout: 'rayzen-sessao-cmsandbox000', stderr: '', code: 0, timedOut: false })

    await pararContainerDaSessao('cmsandbox0001', rodar)

    expect(rodar).toHaveBeenCalledTimes(2)
  })

  it('não confirma parada se o container não aparecer após as tentativas', async () => {
    jest.useFakeTimers()
    try {
      const rodar = jest.fn().mockResolvedValue({
        stdout: '', stderr: 'No such container: rayzen-sessao-cmsandbox000', code: 1, timedOut: false,
      })
      const parada = pararContainerDaSessao('cmsandbox0001', rodar)
      const resultado = expect(parada).rejects.toThrow(/após 40 tentativas/)

      await jest.advanceTimersByTimeAsync(10_000)

      await resultado
      expect(rodar).toHaveBeenCalledTimes(40)
    } finally {
      jest.useRealTimers()
    }
  })
})

describe('resultado JSON do Claude na sandbox', () => {
  const fixture = JSON.stringify({
    type: 'result',
    subtype: 'success',
    is_error: false,
    result: 'Trabalho concluído.',
    total_cost_usd: 0.0123,
    num_turns: 2,
    session_id: 'sessao-123',
    duration_ms: 4567,
    modelUsage: { 'claude-sonnet-4-5': { inputTokens: 100, outputTokens: 50 } },
  })

  it('extrai o texto e as métricas do resultado documentado', () => {
    expect(lerResultadoDoClaude(fixture)).toEqual({
      texto: 'Trabalho concluído.',
      custoUsd: 0.0123,
      turnos: 2,
      sessaoId: 'sessao-123',
      duracaoMs: 4567,
      modelo: 'claude-sonnet-4-5',
    })
  })

  it('preserva o texto do resultado quando o Claude reporta erro', () => {
    expect(lerResultadoDoClaude(JSON.stringify({
      type: 'result', subtype: 'error_max_turns', is_error: true, result: 'Limite atingido.',
    }))).toEqual({ texto: 'Limite atingido.', erro: 'error_max_turns' })
  })

  it('usa o stdout cru e não inventa métricas sem result', () => {
    expect(lerResultadoDoClaude(JSON.stringify({ type: 'result', session_id: 's1', total_cost_usd: 3 })))
      .toEqual({ texto: '{"type":"result","session_id":"s1","total_cost_usd":3}' })
  })

  it('usa o stdout cru quando não é JSON', () => {
    expect(lerResultadoDoClaude('saída antiga em texto')).toEqual({ texto: 'saída antiga em texto' })
  })

  it('solicita JSON e chama aoMedir mantendo o retorno textual', async () => {
    const linhas = [
      JSON.stringify({ type: 'assistant', message: { content: [
        { type: 'text', text: 'Implementando a solução.' },
        { type: 'tool_use', name: 'Edit', input: { file_path: 'src/x.ts' } },
      ] } }),
      fixture,
    ]
    const stdout = `${linhas.join('\n')}\n`
    const executar = jest.fn().mockImplementation((_programa, _args, opts) => {
      for (const linha of linhas) opts.aoStdout?.(`${linha}\n`)
      return Promise.resolve({ stdout, stderr: '', code: 0, timedOut: false })
    })
    const medir = jest.fn()
    const progresso = jest.fn()
    const modelo = modeloNaSandbox(executar, { permitidas: ['Read'], negadas: ['Write'] })

    await expect(modelo('resolva', '/work/sessao-x', medir, progresso)).resolves.toBe('Trabalho concluído.')
    expect(executar.mock.calls[0][1]).toEqual(expect.arrayContaining(['--output-format', 'stream-json', '--verbose']))
    expect(medir).toHaveBeenCalledWith({
      custoUsd: 0.0123,
      turnos: 2,
      sessaoId: 'sessao-123',
      duracaoMs: 4567,
      modelo: 'claude-sonnet-4-5',
    })
    expect(progresso.mock.calls).toEqual([['💬 Implementando a solução.'], ['🔧 Edit src/x.ts']])
  })

  it('não envia métricas quando o processo termina com erro', async () => {
    const executar = jest.fn().mockImplementation((_programa, _args, opts) => {
      opts.aoStdout?.(`${fixture}\n`)
      return Promise.resolve({ stdout: `${fixture}\n`, stderr: '', code: 1, timedOut: false })
    })
    const medir = jest.fn()
    const modelo = modeloNaSandbox(executar, { permitidas: ['Read'], negadas: ['Write'] })

    await expect(modelo('resolva', '/work/sessao-x', medir)).rejects.toThrow()
    expect(medir).not.toHaveBeenCalled()
  })
})

describe('linhaDeProgresso — NDJSON do Claude', () => {
  it('transforma texto e ferramenta; evento result preserva métricas sem linha de progresso', () => {
    const texto = `Alteração aplicada.\n${'x'.repeat(140)}`
    expect(linhaDeProgresso(JSON.stringify({
      type: 'assistant',
      message: { content: [
        { type: 'text', text: texto },
        { type: 'tool_use', name: 'Edit', input: { file_path: 'src/x.ts' } },
      ] },
    }))).toEqual({
      linhas: [`💬 Alteração aplicada. ${'x'.repeat(100)}`, '🔧 Edit src/x.ts'],
    })
    expect(linhaDeProgresso(JSON.stringify({
      type: 'result', subtype: 'success', is_error: false, result: 'Trabalho concluído.',
      total_cost_usd: 0.0123, num_turns: 2, session_id: 's1', duration_ms: 4567,
      modelUsage: { 'claude-sonnet-4-5': { inputTokens: 10, outputTokens: 20 } },
    }))).toEqual({
      linhas: [],
      resultado: expect.objectContaining({ texto: 'Trabalho concluído.', custoUsd: 0.0123, turnos: 2 }),
    })
  })

  it('ignora NDJSON inválido ou eventos que não representam progresso', () => {
    expect(linhaDeProgresso('{ JSON incompleto')).toBeNull()
    expect(linhaDeProgresso(JSON.stringify({ type: 'system', subtype: 'init' }))).toBeNull()
  })
})

describe('nomes que viram caminho ou argumento', () => {
  it('pasta por sessão, só [a-z0-9], 12 caracteres', () => {
    expect(pastaDaSessao('CMsessao-0001xyz')).toBe('sessao-cmsessao0001')
    expect(() => pastaDaSessao('---')).toThrow()
  })
  it.each(['../etc', '-rf', 'a b', '', 'x/y'])('repositório "%s" é recusado', (nome) => {
    expect(() => pastaDoProjetoNoHost(nome)).toThrow()
  })
  it('a pasta do projeto fica sob a raiz dos workspaces, configurável', () => {
    expect(pastaDoProjetoNoHost('rayzen-marcenaria', {})).toBe('/home/rayzen/workspaces/rayzen-marcenaria')
    expect(pastaDoProjetoNoHost('r', { SANDBOX_WORKSPACES_HOST: '/srv/ws/' })).toBe('/srv/ws/r')
  })
  it('o link do VS Code abre a pasta da sessão pelo Remote-SSH', () => {
    expect(linkDoVscode('rayzen-marcenaria', 'cmwk15xy40001', {}))
      .toBe('vscode://vscode-remote/ssh-remote+rayzen@192.0.2.10/home/rayzen/workspaces/rayzen-marcenaria/sessao-cmwk15xy4000')
  })
  it('o clone recebe dono e repo como argumentos posicionais, nunca dentro do script', async () => {
    const executar = jest.fn().mockResolvedValue({ stdout: '', stderr: '', code: 0, timedOut: false }) as unknown as jest.MockedFunction<Executor>
    const r = await prepararCloneNaSandbox(executar, 'marcelorayzen', 'rayzen-marcenaria', 'cmwk15xy40001')
    expect(r).toEqual({ ok: true, base: '/work/sessao-cmwk15xy4000' })
    const [programa, args] = executar.mock.calls[0]
    expect(programa).toBe('bash')
    expect(args.slice(-4)).toEqual(['_', 'marcelorayzen', 'rayzen-marcenaria', 'sessao-cmwk15xy4000'])
    expect(args[1]).not.toContain('rayzen-marcenaria')
    // Identidade decidida em 16/11: "Rayzen", e-mail noreply do dono.
    expect(args[1]).toContain('git config user.name Rayzen')
    expect(args[1]).toContain('$1@users.noreply.github.com')
  })
  it('nome perigoso nem chega ao executor', async () => {
    const executar = jest.fn() as unknown as Executor
    await expect(prepararCloneNaSandbox(executar, 'x', '../../etc', 's1')).resolves.toMatchObject({ ok: false })
    expect(executar).not.toHaveBeenCalled()
  })
})

describe('baseRef — a sessão parte do ramo de um PR (G6, fatia 4)', () => {
  it('aceita nomes de ramo comuns e recusa o que viraria opção ou caminho estranho', () => {
    for (const ok of ['main', 'feature/pr-7', 'fix_ci.2', 'dependabot/npm/x-1.2.3']) expect(refDeBaseValida(ok)).toBe(true)
    for (const ruim of ['-c', '--upload-pack=x', 'a..b', 'a//b', '/abs', 'fim/', 'x.lock', 'tem espaço', 'a;b', '', 42, 'a\nb']) {
      expect(refDeBaseValida(ruim)).toBe(false)
    }
  })

  it('com baseRef, busca o ramo e parte de origin/<baseRef>, com o nome como argumento — nunca no script', async () => {
    const chamadas: string[][] = []
    const executar: Executor = async (_p, args) => { chamadas.push([...args]); return { stdout: 'abc123\n', stderr: '', code: 0, timedOut: false } }
    await criarRamoNaSandbox(executar, '/work/x', 'rayzen/sessao-1', 'feature/pr-7')
    const [args] = chamadas
    expect(args.slice(-3)).toEqual(['_', 'rayzen/sessao-1', 'feature/pr-7'])
    expect(args[1]).toMatch(/git fetch -q origin "\+refs\/heads\/\$2:refs\/remotes\/origin\/\$2"/)
    expect(args[1]).toMatch(/git checkout -q -B "\$1" "refs\/remotes\/origin\/\$2"/)
    expect(args[1]).not.toContain('feature/pr-7')
  })

  it('sem baseRef, o comportamento de antes: topo do branch padrão', async () => {
    const chamadas: string[][] = []
    const executar: Executor = async (_p, args) => { chamadas.push([...args]); return { stdout: 'abc123\n', stderr: '', code: 0, timedOut: false } }
    await criarRamoNaSandbox(executar, '/work/x', 'rayzen/sessao-1')
    expect(chamadas[0].slice(-2)).toEqual(['_', 'rayzen/sessao-1'])
    expect(chamadas[0][1]).toMatch(/symbolic-ref --quiet refs\/remotes\/origin\/HEAD/)
  })

  it('baseRef inválido é recusado antes de chamar o git', async () => {
    const executar = jest.fn()
    await expect(criarRamoNaSandbox(executar as never, '/work/x', 'rayzen/sessao-1', '--upload-pack=evil')).rejects.toThrow(/inválido/)
    expect(executar).not.toHaveBeenCalled()
  })
})

describe('regime e repositório', () => {
  it('só liga no agent-server e com a variável explícita', () => {
    expect(regimeSandboxLigado({ AGENT_ROLE: 'server', AGENT_SESSAO_SANDBOX: 'true' })).toBe(true)
    expect(regimeSandboxLigado({ AGENT_ROLE: 'desktop', AGENT_SESSAO_SANDBOX: 'true' })).toBe(false)
    expect(regimeSandboxLigado({ AGENT_ROLE: 'server' })).toBe(false)
  })
  it('projeto sem repoSlug é recusado com motivo', async () => {
    await expect(repositorioDoProjeto('p1', async () => ({ repoSlug: null }), {})).resolves.toMatchObject({ erro: expect.stringMatching(/não tem repoSlug/) })
  })
  it('dono vem da configuração, repo do projeto', async () => {
    await expect(repositorioDoProjeto('p1', async () => ({ repoSlug: 'rayzen-marcenaria' }), { SANDBOX_GH_OWNER: 'outro' }))
      .resolves.toEqual({ dono: 'outro', repo: 'rayzen-marcenaria' })
  })
})

describe('garantirPastaDoProjeto — cria a pasta com o dono certo, sem rede', () => {
  it('container mínimo: sem rede, uid do dono, só mkdir na raiz dos workspaces', async () => {
    const rodar = jest.fn().mockResolvedValue({ stdout: '', stderr: '', code: 0, timedOut: false })
    const r = await garantirPastaDoProjeto('rayzen-marcenaria', rodar, { PATH: '/bin' })
    expect(r).toEqual({ ok: true, pasta: '/home/rayzen/workspaces/rayzen-marcenaria' })
    const argv: string[] = rodar.mock.calls[0][1]
    expect(argv[argv.indexOf('--network') + 1]).toBe('none')
    expect(argv[argv.indexOf('--user') + 1]).toBe('1000:1000')
    expect(argv.slice(-4)).toEqual(['mkdir', '-p', '--', '/ws/rayzen-marcenaria'])
    expect(argv.join(' ')).not.toMatch(/GH_TOKEN|CLAUDE_CODE_OAUTH_TOKEN/)
  })
  it('nome perigoso nem chega ao docker', async () => {
    const rodar = jest.fn()
    await expect(garantirPastaDoProjeto('../x', rodar, {})).resolves.toMatchObject({ ok: false })
    expect(rodar).not.toHaveBeenCalled()
  })
})

describe('mudança só de documentação (24/11) — a prévia não mostraria nada', () => {
  it('só .md/.txt é documentação', () => {
    expect(mudancaSoDeDocumentacao(['README.md'])).toBe(true)
    expect(mudancaSoDeDocumentacao(['docs/guia.MD', 'NOTAS.txt', 'manual.mdx'])).toBe(true)
  })
  it('qualquer arquivo de código, lista vazia ou não medida: não é', () => {
    expect(mudancaSoDeDocumentacao(['README.md', 'src/App.tsx'])).toBe(false)
    expect(mudancaSoDeDocumentacao(['docs/site.config.js'])).toBe(false)
    expect(mudancaSoDeDocumentacao(['README.md.ts'])).toBe(false)
    expect(mudancaSoDeDocumentacao([])).toBe(false)
    expect(mudancaSoDeDocumentacao(null)).toBe(false)
  })
  it('a lista vem de --name-only; falha de git vira null, não lista vazia', async () => {
    const ok: Executor = async () => ({ stdout: 'README.md\n\nsrc/a.ts\n', stderr: '', code: 0, timedOut: false })
    const falha: Executor = async () => ({ stdout: '', stderr: 'fatal', code: 128, timedOut: false })
    await expect(arquivosAlteradosNaSandbox(ok, '/work/x', 'abc')).resolves.toEqual(['README.md', 'src/a.ts'])
    await expect(arquivosAlteradosNaSandbox(falha, '/work/x', 'abc')).resolves.toBeNull()
  })
})
