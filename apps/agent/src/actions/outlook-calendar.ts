import { rodarHelper, type ExecutorDeHelper } from '../exec/executar-helper'

export interface CalendarEvent {
  subject: string
  start: string
  end: string
  location: string
  organizer: string
}

/**
 * Migrado na Fase 1. O código anterior formatava `today`/`until` em TypeScript e os
 * interpolava no corpo de um `.ps1` gerado por template — nunca explorável na prática
 * (`toLocaleDateString` só produz dígitos e barras), mas exigia confiar nisso para sempre.
 *
 * `scripts/outlook-calendar.ps1` recebe só `days` (inteiro, já clampado) por stdin e calcula
 * as datas do filtro ele mesmo, com `Get-Date` — não há valor externo para desconfiar,
 * porque não há valor externo nenhum além do inteiro.
 */
export async function getCalendar(
  payload: { days?: number },
  executor?: ExecutorDeHelper,
): Promise<{ events: CalendarEvent[]; date: string }> {
  const days = Math.min(payload.days ?? 1, 7)
  const today = new Date().toLocaleDateString('en-US')

  const output = rodarHelper('outlook-calendar', JSON.stringify({ days }), executor).trim()
  if (!output || output === 'null') return { events: [], date: today }

  const raw = JSON.parse(output)
  const events = (Array.isArray(raw) ? raw : [raw]).map((e: Record<string, unknown>) => ({
    subject: String(e['Subject'] ?? ''),
    start: String(e['Start'] ?? ''),
    end: String(e['End'] ?? ''),
    location: String(e['Location'] ?? ''),
    organizer: String(e['Organizer'] ?? ''),
  }))

  return { events, date: today }
}
