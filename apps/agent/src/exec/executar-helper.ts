import { execFileSync } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'

/**
 * Executa um helper `.ps1` **fixo e versionado**, com o payload viajando por **stdin**.
 *
 * ## Por que não é "escapar melhor"
 *
 * `clipboard_write` e `notify` montavam o comando por template com o payload dentro. Provado
 * em 2026-09-07, montando a string sem executar:
 *
 * ```
 * clipboard, payload  x'; Write-Output PWNED; '
 *   → powershell -Command "Set-Clipboard -Value 'x'; Write-Output PWNED; ''"
 * notify, payload  $(Write-Output PWNED)
 *   → sobrevive ao sanitizador (que só troca " por ') e cai em string de aspas duplas,
 *     onde $( ) é subexpressão
 * ```
 *
 * A resposta não é um sanitizador melhor — é a do arXiv 2603.27517 sobre o OpenClaw: enquanto
 * a decisão depender de prever como um interpretador vai ler um texto, cada bypass gera mais
 * uma regra. **Tira-se o texto do caminho.** O argv contém só o caminho do helper, que é
 * constante; o payload entra pelo canal de dados.
 *
 * ## `shell: false`, por construção
 *
 * `execFileSync` não passa por shell. O `-File` do PowerShell recebe um caminho, não um
 * comando: não há `-Command` para interpretar. Proibido usar `-Command` aqui — há teste.
 */

/** Nomes de helper fixo — cada um é um `.ps1` versionado em `apps/agent/scripts/`. */
export type NomeDeHelper =
  | 'clipboard-write' | 'notify'
  | 'outlook-read' | 'outlook-send' | 'outlook-calendar'
  | 'screenshot'

/** Onde os helpers moram. Resolvido a partir do módulo, não do cwd — o agent roda de vários. */
export function caminhoDoHelper(nome: NomeDeHelper): string {
  // `dist/exec/` → sobe dois para `apps/agent/`, onde `scripts/` vive. Em `src/` a conta é a
  // mesma; por isso a checagem de existência abaixo, que falha alto em vez de silenciosa.
  return join(__dirname, '..', '..', 'scripts', `${nome}.ps1`)
}

export interface ExecutorDeHelper {
  (programa: string, args: string[], entrada: string): string
}

/**
 * Executor real. Injetável **de propósito**: nenhum teste desta área pode iniciar processo,
 * shell, gerenciador de pacotes ou rede. Em 2026-09-08 um teste meu rodou `pnpm install` de
 * verdade porque o executor era importado direto — teste de segurança que executa o comando
 * que testa é um teste que causa o que investiga.
 */
export const executorReal: ExecutorDeHelper = (programa, args, entrada) =>
  execFileSync(programa, args, {
    input:    entrada,
    encoding: 'utf-8',
    timeout:  10_000,
    windowsHide: true,
  })

export function rodarHelper(
  nome: NomeDeHelper,
  entrada: string,
  executor: ExecutorDeHelper = executorReal,
): string {
  const helper = caminhoDoHelper(nome)
  if (!existsSync(helper)) {
    // Falha alta: helper ausente significaria cair de volta no caminho que interpola.
    throw new Error(`Helper não encontrado: ${helper}. Rode o build do agent.`)
  }

  return executor(
    'powershell.exe',
    // `-File` recebe CAMINHO. Nunca `-Command`, que receberia texto a ser interpretado.
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', helper],
    entrada,
  )
}
