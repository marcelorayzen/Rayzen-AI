import { execFileSync, spawn } from 'child_process'
import { existsSync, readFileSync } from 'fs'
import { dirname, join } from 'path'

/**
 * ── `executarPrograma()` — Fase 1 de `docs/plano-execucao-tipada.md` ────────────────────────
 *
 * Na Fase 0 (07/09), 17 dos 57 pontos de execução do agent montavam uma STRING de comando com
 * valor interpolado dentro — número histórico, não o atual: `docs/exec-paths.md` mostra hoje
 * 38 pontos e 0 montados, consolidação em cima da migração que este módulo entrega, não perda
 * de pontos. Enquanto a autorização olhar para texto, a
 * decisão depende de prever como um shell vai interpretá-lo — e cada bypass encontrado gera
 * mais uma regra, sem a premissa nunca mudar (arXiv 2603.27517). Este módulo tira o texto do
 * caminho: o que se executa é um programa com **`shell: false`**, argumentos como VETOR, nunca
 * como string a ser reinterpretada.
 *
 * ## O que NÃO está aqui
 *
 * `helperFixo` (script `.ps1` fixo, payload por stdin) já existe desde a Fase 1-A em
 * `exec/executar-helper.ts` (`rodarHelper`) — não duplicado aqui, porque a forma da chamada é
 * outra (stdin, não argv). `tarefaAgendada` não tem capability nenhuma que a use ainda —
 * declarada no tipo, não implementada: melhor recusar alto do que fingir suporte.
 *
 * Capability tipada (`{ capability, params }` no lugar de linha de comando) é Fase 2. `cwd` por
 * `projectId` é Fase 3. Aqui o chamador ainda passa `cwd`/`env` já resolvidos — mas os dois são
 * **obrigatórios e explícitos**: não há default que caia em `process.cwd()` nem em
 * `process.env`, que é exatamente o que as Fases 3 e 4 vêm fechar depois.
 */

export type EstrategiaExecucao = 'executavel' | 'entrypointJs' | 'helperFixo' | 'tarefaAgendada'

export interface OpcoesDeExecucao {
  /** Diretório de trabalho já resolvido pelo chamador — nunca uma string livre vinda de payload. */
  readonly cwd: string
  /** Ambiente explícito. Nunca `process.env` espalhado — ver `ambientePadrao()`. */
  readonly env: NodeJS.ProcessEnv
  readonly timeoutMs: number
}

export interface ResultadoDeExecucao {
  readonly stdout: string
  readonly stderr: string
  readonly code: number | null
  readonly timedOut: boolean
}

/** Nome de programa não é caminho: sem espaço, sem barra, sem metacaractere. */
const NOME_DE_PROGRAMA_SEGURO = /^[a-zA-Z0-9_.-]+$/

function validarNomeDoPrograma(programa: string): void {
  if (!NOME_DE_PROGRAMA_SEGURO.test(programa)) {
    throw new Error(
      `executarPrograma: nome de programa inválido "${programa}" — proibido espaço, "/", "\\" ` +
      `ou metacaractere. Nome de programa não é caminho (decisão do plano de execução tipada).`,
    )
  }
}

/**
 * Variáveis de sistema que quase todo processo-filho no Windows precisa para sequer iniciar —
 * resolução de biblioteca, temp, terminal. **Não é `process.env` espalhado**: é lista fechada,
 * a mesma classe de decisão que `ambienteMinimo()` já tomou em `supervised-session.ts` (Fase
 * 4), sem nada específico do Claude Code CLI. Quem chama `executarPrograma()` decide o que MAIS
 * entra — isto é o piso, nunca o teto.
 */
export function ambientePadrao(fonte: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const chaves = [
    'PATH', 'SystemRoot', 'SystemDrive', 'windir', 'COMSPEC', 'PATHEXT', 'TEMP', 'TMP', 'USERPROFILE',
  ] as const
  const saida: NodeJS.ProcessEnv = {}
  for (const chave of chaves) {
    const v = fonte[chave]
    if (v !== undefined) saida[chave] = v
  }
  return saida
}

/**
 * Resolve, uma vez, o `.js` real por trás de um wrapper `.cmd`/`.bat` no Windows (`pnpm`,
 * `npx`, …). `execFile`/`spawn` com `shell: false` não interpreta `.cmd` como o shell
 * interpreta — e `shell: true` está PROIBIDO como saída: devolveria exatamente o problema que
 * este plano existe para eliminar, de forma pior, porque pareceria resolvido.
 *
 * Não presume o layout (`node_modules/corepack/dist/pnpm.js`) — LÊ o wrapper de verdade e
 * extrai o caminho, porque é o que o wrapper vai executar de fato nesta máquina, com esta
 * versão. Medido em 11/09 nesta máquina: `pnpm.CMD` e `npx.cmd` seguem o mesmo padrão
 * (`%~dp0\node_modules\...\*.js`), mas presumir isso sem ler seria a mesma aposta que este
 * plano existe para não fazer.
 *
 * `where.exe` lista TODAS as extensões que casam o nome, na ordem das pastas do PATH — inclui
 * entradas sem extensão (script POSIX, inútil no Windows) e `.ps1` (que `PATHEXT` nem declara).
 * Só o primeiro `.cmd`/`.bat` é o que uma invocação real usaria.
 */
export interface EntrypointResolvido {
  /** O que roda o `.js` — quase sempre `node.exe`, mas nem sempre: medido em 11/09, o
   * `code.cmd` do VS Code lança `Code.exe` (Electron) em vez de `node.exe`. */
  readonly runner: string
  readonly js: string
  /** Variáveis que o próprio wrapper declara antes de invocar — ex.: `ELECTRON_RUN_AS_NODE=1`.
   * Só captura `set VARNAME=valor` com valor LITERAL (sem `%`); um valor com `%` é substituição
   * de batch, e replicar isso exigiria implementar a semântica do `cmd.exe` — melhor não presumir. */
  readonly envExtra: Readonly<Record<string, string>>
}

const cacheEntrypointJs = new Map<string, EntrypointResolvido>()

export function resolverEntrypointJs(nomeComando: string): EntrypointResolvido {
  const emCache = cacheEntrypointJs.get(nomeComando)
  if (emCache) return emCache

  validarNomeDoPrograma(nomeComando)

  // `where.exe` SAI COM CÓDIGO 1 (e escreve em stderr) quando não acha nada — `execFileSync`
  // trata isso como falha e LANÇA, não devolve string vazia. Sem o catch, o erro que
  // atravessa é o bruto do processo ("Command failed: where.exe ...", na codepage do
  // console), não a mensagem clara que este módulo promete.
  let saida = ''
  try {
    saida = execFileSync('where.exe', [nomeComando], { encoding: 'utf8' })
  } catch {
    saida = ''
  }
  const wrapper = saida
    .split(/\r?\n/)
    .map(l => l.trim())
    .find(l => /\.(cmd|bat)$/i.test(l))

  if (!wrapper) {
    throw new Error(
      `resolverEntrypointJs: nenhum .cmd/.bat para "${nomeComando}" no PATH — capability com ` +
      `estratégia entrypointJs precisa disso para existir. Falha na subida, não em runtime.`,
    )
  }

  const conteudo = readFileSync(wrapper, 'utf8')
  const referencia = conteudo.match(/%~dp0\\?([^"%\r\n]+\.js)/i)
  if (!referencia) {
    throw new Error(
      `resolverEntrypointJs: não consegui extrair o caminho do .js de ${wrapper} — o wrapper ` +
      `mudou de formato. Declare a estratégia manualmente para "${nomeComando}" em vez de confiar no parser.`,
    )
  }

  const caminhoJs = join(dirname(wrapper), referencia[1])
  if (!existsSync(caminhoJs)) {
    throw new Error(`resolverEntrypointJs: ${caminhoJs} (extraído de ${wrapper}) não existe.`)
  }

  // Runner: o `.exe` que o próprio wrapper chama para rodar o `.js`. `pnpm.CMD`/`npx.cmd`
  // chamam `node.exe`; `code.cmd` chama `Code.exe`, com `ELECTRON_RUN_AS_NODE=1` — não dá
  // para presumir node.exe sempre. Sem declaração própria, cai no node.exe deste processo.
  const referenciaRunner = conteudo.match(/"%~dp0([^"]*\.exe)"/i)
  const runner = referenciaRunner
    ? join(dirname(wrapper), referenciaRunner[1])
    : process.execPath
  if (!existsSync(runner)) {
    throw new Error(`resolverEntrypointJs: runner ${runner} (extraído de ${wrapper}) não existe.`)
  }

  const envExtra: Record<string, string> = {}
  for (const m of conteudo.matchAll(/^\s*set\s+([A-Za-z_][A-Za-z0-9_]*)=([^\r\n%]*)$/gim)) {
    envExtra[m[1]] = m[2]
  }

  const resolvido: EntrypointResolvido = { runner, js: caminhoJs, envExtra }
  cacheEntrypointJs.set(nomeComando, resolvido)
  return resolvido
}

function spawnComShellFalse(
  comando: string,
  args: readonly string[],
  opts: OpcoesDeExecucao,
): Promise<ResultadoDeExecucao> {
  return new Promise((resolve, reject) => {
    // `shell: false` É A PROIBIÇÃO DO PLANO — nunca mude para `true` nem omita (o default do
    // Node já é `false`, mas fica explícito porque o teste anti-drift lê este arquivo como
    // texto). Ver `executar-programa-shell-false.spec.ts`.
    const proc = spawn(comando, args as string[], {
      cwd: opts.cwd,
      env: opts.env,
      shell: false,
      windowsHide: true,
    })

    let stdout = ''
    let stderr = ''
    let concluiu = false
    let expirou = false

    const timer = setTimeout(() => {
      expirou = true
      proc.kill()
    }, opts.timeoutMs)

    proc.stdout?.on('data', (d: Buffer) => { stdout += d.toString('utf8') })
    proc.stderr?.on('data', (d: Buffer) => { stderr += d.toString('utf8') })

    proc.on('error', (err) => {
      if (concluiu) return
      concluiu = true
      clearTimeout(timer)
      reject(err)
    })

    proc.on('close', (code) => {
      if (concluiu) return
      concluiu = true
      clearTimeout(timer)
      resolve({ stdout, stderr, code, timedOut: expirou })
    })
  })
}

/**
 * O ponto único. `estrategia` é sempre explícita — não há default nem heurística (decisão 7 do
 * plano): quem declara a capability decide como ela é lançada, e uma estratégia que não resolve
 * falha alto, na subida, nunca em silêncio no meio de uma execução.
 */
export async function executarPrograma(
  estrategia: EstrategiaExecucao,
  programa: string,
  args: readonly string[],
  opts: OpcoesDeExecucao,
): Promise<ResultadoDeExecucao> {
  validarNomeDoPrograma(programa)

  if (estrategia === 'executavel') {
    return spawnComShellFalse(programa, args, opts)
  }

  if (estrategia === 'entrypointJs') {
    const { runner, js, envExtra } = resolverEntrypointJs(programa)
    // `envExtra` por cima do `opts.env` do chamador: é o que o PRÓPRIO wrapper declara
    // precisar para funcionar (ex.: `ELECTRON_RUN_AS_NODE=1` do VS Code) — sem isso o
    // Code.exe abriria uma janela do editor em vez de rodar o cli.js como Node.
    return spawnComShellFalse(runner, [js, ...args], { ...opts, env: { ...opts.env, ...envExtra } })
  }

  if (estrategia === 'helperFixo') {
    throw new Error(
      'executarPrograma: "helperFixo" não é implementada aqui — use rodarHelper() de ' +
      'exec/executar-helper.ts (Fase 1-A), que já cobre esse caso: payload por stdin, "-File".',
    )
  }

  // tarefaAgendada — nenhuma capability usa ainda.
  throw new Error(
    'executarPrograma: "tarefaAgendada" declarada no tipo, sem implementação — nenhuma ' +
    'capability a usa hoje. Recusar alto é melhor que fingir suporte.',
  )
}
