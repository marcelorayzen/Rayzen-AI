import { rodarHelper, type ExecutorDeHelper } from '../exec/executar-helper'

/**
 * Migrado na Fase 1: script montado por `.join('; ')` com `${project}`/`${filename}`
 * interpolados dentro → `helperFixo`, payload por stdin. Os dois já eram sanitizados
 * (`sanitize()`, só `[a-zA-Z0-9_-]`), mas isso era segurança por convenção da chamada, não
 * por construção do transporte — ver `scripts/screenshot.ps1`.
 */
export async function takeScreenshot(
  payload?: { projectName?: string; projectFolder?: string; label?: string },
  executor?: ExecutorDeHelper,
): Promise<{ path: string; takenAt: string }> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')

  // Organiza por projeto: Pictures\Rayzen\{projeto}\{label}-{ts}.png
  // Sem projeto: Pictures\Rayzen\geral\{ts}.png
  const project = sanitize(payload?.projectFolder ?? payload?.projectName) ?? 'geral'
  const prefix  = sanitize(payload?.label) ?? 'screenshot'
  const filename = `${prefix}-${timestamp}.png`

  const result = rodarHelper('screenshot', JSON.stringify({ project, filename }), executor).trim()

  return { path: result, takenAt: new Date().toISOString() }
}

function sanitize(s?: string): string | undefined {
  if (!s) return undefined
  return s.replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 40)
}
