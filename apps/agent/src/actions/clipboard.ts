import { execFileSync } from 'child_process'
import { rodarHelper, type ExecutorDeHelper } from '../exec/executar-helper'

/**
 * Leitura não recebe payload, então não há o que interpolar. Ainda assim usa `execFileSync`
 * (sem shell) e argumentos em vetor — o padrão que a Fase 1 vai generalizar.
 */
export async function clipboardRead(): Promise<{ content: string }> {
  const content = execFileSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', 'Get-Clipboard'],
    { encoding: 'utf-8', timeout: 5000, windowsHide: true },
  )
  return { content: content.trim() }
}

/**
 * Escrita — Fase 1-A. O texto vai por **stdin** para um helper fixo; nada é interpolado.
 *
 * ## O vetor real, e a correção do que eu havia afirmado
 *
 * Em 07/09 registrei que esta ação era injetável e "provei" com um payload de aspa **simples**.
 * A prova estava errada: o código já dobrava `'` (`replace(/'/g, "''")`), e dentro de string
 * de aspas simples do PowerShell isso é o escape correto — aquele payload não injetava.
 *
 * O vetor real é a aspa **dupla**, que fecha o `-Command` do lado de fora:
 *
 * ```
 * payload  x"; Write-Output PWNED; "
 *   → powershell -NoProfile -Command "Set-Clipboard -Value 'x"; Write-Output PWNED; "'"
 * ```
 *
 * O escape cuidava do delimitador de dentro e ignorava o de fora. É a razão de não se corrigir
 * isto com "escapar melhor": há mais de uma camada de citação, e acertar todas exige prever o
 * parser — a premissa que o arXiv 2603.27517 mostra falhando.
 */
export async function clipboardWrite(
  payload: { text: string },
  executor?: ExecutorDeHelper,
): Promise<{ written: boolean }> {
  rodarHelper('clipboard-write', payload.text, executor)
  return { written: true }
}
