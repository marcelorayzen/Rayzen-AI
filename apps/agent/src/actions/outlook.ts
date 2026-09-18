import { rodarHelper, type ExecutorDeHelper } from '../exec/executar-helper'

/**
 * Migrado na Fase 1 — e é o achado mais sério dela.
 *
 * O código anterior gerava um `.ps1` por template string, com `$mail.To = "${to}"` dentro
 * de aspas DUPLAS do PowerShell. `to` vem de payload (endereço de e-mail), validado só com
 * `.includes('@')`. `$( )` dentro de aspas duplas do PowerShell é subexpressão: um payload
 * `to: 'x$(calc.exe)'` produzia um script contendo literalmente `.To = "x$(calc.exe)"`, e o
 * PowerShell EXECUTARIA `calc.exe` ao simplesmente atribuir a propriedade — antes de
 * qualquer `.Send()`. `subject`/`body` usavam here-string (`@'...'@`), mais resistente, mas
 * quebrável por uma linha igual a `'@` no início.
 *
 * Nunca tinha sido testado adversarialmente como `clipboard_write`/`notify` foram na
 * Fase 1-A — a Fase 0 nem chegou a olhar este arquivo. A cura é a mesma: `helperFixo`,
 * payload por stdin como JSON, lido com `ConvertFrom-Json` e atribuído direto à propriedade
 * do objeto COM. Ver `scripts/outlook-send.ps1`.
 */

export interface EmailSummary {
  subject: string
  from: string
  receivedAt: string
  preview: string
  unread: boolean
}

export async function readEmails(
  payload: { limit?: number; folder?: string },
  executor?: ExecutorDeHelper,
): Promise<{ emails: EmailSummary[] }> {
  const limit = Math.min(payload.limit ?? 5, 20)

  const output = rodarHelper('outlook-read', JSON.stringify({ limit }), executor).trim()
  if (!output) throw new Error('Outlook não está aberto ou não respondeu. Abra o Outlook e tente novamente.')
  const raw = JSON.parse(output)
  const emails = (Array.isArray(raw) ? raw : [raw]).map((e: Record<string, unknown>) => ({
    subject: String(e['Subject'] ?? ''),
    from: String(e['From'] ?? ''),
    receivedAt: String(e['ReceivedAt'] ?? ''),
    preview: String(e['Preview'] ?? ''),
    unread: Boolean(e['Unread']),
  }))

  return { emails }
}

export async function sendEmail(
  payload: { to: string; subject: string; body: string; dryRun?: boolean },
  executor?: ExecutorDeHelper,
): Promise<{ sent: boolean; to: string; subject: string; dryRun: boolean }> {
  const { to, subject, body, dryRun = true } = payload

  if (!to.includes('@')) throw new Error(`Endereço inválido: ${to}`)
  if (!subject.trim()) throw new Error('Assunto obrigatório')
  if (!body.trim()) throw new Error('Corpo do email obrigatório')

  if (dryRun) {
    return { sent: false, to, subject, dryRun: true }
  }

  rodarHelper('outlook-send', JSON.stringify({ to, subject, body }), executor)
  return { sent: true, to, subject, dryRun: false }
}
