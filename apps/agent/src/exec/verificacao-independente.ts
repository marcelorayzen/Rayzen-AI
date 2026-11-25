import { executarPrograma, type ResultadoDeExecucao } from './executar-programa'
import { argsDeContainerSemCredencial, ambienteSemCredencial, type Rodar } from './previa-ao-vivo'
import { pastaDaSessao, pastaDoProjetoNoHost } from './sandbox'
import type { Executor } from './publicar-entrega'

export const TIMEOUT_VERIFICACAO_MS = 10 * 60 * 1000
const COMANDO_DE_VERIFICACAO = 'npm ci --no-audit --no-fund && npm test'
const rodarNoHost: Rodar = (programa, args, opts) =>
  executarPrograma('executavel', programa, args, opts)

export interface VerificacaoIndependenteDaSessao {
  status: 'passou' | 'falhou' | 'timeout' | 'não verificado'
  comando: string
  codigo: number | null
  duracaoMs: number
  ultimasLinhas: string[]
}

function registro(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor)
}

function resultadoNaoVerificado(comando: string): VerificacaoIndependenteDaSessao {
  return { status: 'não verificado', comando, codigo: null, duracaoMs: 0, ultimasLinhas: [] }
}

function ultimasLinhasDeTexto(texto: string): string[] {
  return texto.split(/\r?\n/).map((linha) => linha.trimEnd()).filter(Boolean).slice(-40)
}

function ultimasLinhas(resultado: ResultadoDeExecucao): string[] {
  return ultimasLinhasDeTexto(`${resultado.stdout}${resultado.stderr ? `\n${resultado.stderr}` : ''}`)
}

/**
 * Lê o script do checkout da sessão e executa os testes num container sem credenciais.
 * A reprovação é dado para a pessoa revisar, não um gate de publicação.
 */
export async function verificarTestesIndependentes(
  executarSessao: Executor,
  repo: string,
  sessionId: string,
  deps: {
    rodar?: Rodar
    env?: NodeJS.ProcessEnv
    agora?: () => number
  } = {},
): Promise<VerificacaoIndependenteDaSessao> {
  const env = deps.env ?? process.env
  const cwd = `/work/${pastaDaSessao(sessionId)}`
  let leitura: ResultadoDeExecucao
  try {
    leitura = await executarSessao('bash', ['-c', 'cat package.json'], { cwd, env: {}, timeoutMs: 30_000 })
  } catch (err) {
    return {
      ...resultadoNaoVerificado('não verificado — não consegui ler package.json'),
      ultimasLinhas: ultimasLinhasDeTexto((err as Error).message),
    }
  }
  if (leitura.code !== 0 || leitura.timedOut) {
    return resultadoNaoVerificado('não verificado — não consegui ler package.json')
  }

  let pacote: unknown
  try {
    pacote = JSON.parse(leitura.stdout) as unknown
  } catch {
    return resultadoNaoVerificado('não verificado — package.json não é JSON válido')
  }
  const scripts = registro(pacote) && registro(pacote.scripts) ? pacote.scripts : null
  if (!scripts || typeof scripts.test !== 'string' || !scripts.test.trim()) {
    return resultadoNaoVerificado('não verificado — o projeto não tem script de teste')
  }

  const iniciar = (deps.agora ?? Date.now)()
  let resultado: ResultadoDeExecucao
  try {
    resultado = await (deps.rodar ?? rodarNoHost)(
      'docker',
      argsDeContainerSemCredencial(
        pastaDoProjetoNoHost(repo, env),
        cwd,
        COMANDO_DE_VERIFICACAO,
      ),
      { cwd: '/', env: ambienteSemCredencial(env), timeoutMs: TIMEOUT_VERIFICACAO_MS },
    )
  } catch (err) {
    const duracaoMs = Math.max(0, (deps.agora ?? Date.now)() - iniciar)
    return {
      status: 'falhou',
      comando: COMANDO_DE_VERIFICACAO,
      codigo: null,
      duracaoMs,
      ultimasLinhas: [(err as Error).message].slice(-40),
    }
  }

  const duracaoMs = Math.max(0, (deps.agora ?? Date.now)() - iniciar)
  return {
    status: resultado.timedOut ? 'timeout' : resultado.code === 0 ? 'passou' : 'falhou',
    comando: COMANDO_DE_VERIFICACAO,
    codigo: resultado.timedOut ? null : resultado.code,
    duracaoMs,
    ultimasLinhas: ultimasLinhas(resultado),
  }
}
