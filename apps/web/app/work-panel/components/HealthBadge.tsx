'use client'

import { useEffect, useState } from 'react'
import { V2_URL } from '../../../lib/api-url'
import { authHeaders } from '../../../lib/api-client'

interface ServiceCheck { ok: boolean; latencyMs: number; note?: string }
interface HealthReport {
  healthy: boolean
  degraded: boolean
  services: { litellm: ServiceCheck; database: ServiceCheck; v1bridge: ServiceCheck }
  blockedIntentTypes: string[]
  checkedAt: string
}

const POLL_MS = 30_000

const SERVICE_LABELS: Record<'litellm' | 'database' | 'v1bridge', string> = {
  litellm:  'LiteLLM',
  database: 'Banco V2',
  v1bridge: 'Bridge V1',
}

/**
 * Badge do JARVISHealthCheck — verde (ok) / amarelo (degradado) / vermelho (crítico).
 * Torna visível o estado da infra que o Router usa para decidir o que pode ser servido.
 * Consome GET /v2/route/health (poll 30s).
 */
export function HealthBadge() {
  const [report, setReport] = useState<HealthReport | null>(null)
  const [error, setError] = useState(false)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    let alive = true
    const load = async () => {
      try {
        const res = await fetch(`${V2_URL}/route/health`, { headers: authHeaders() })
        if (!alive) return
        if (!res.ok) { setError(true); setReport(null); return }
        setReport(await res.json() as HealthReport)
        setError(false)
      } catch {
        if (alive) { setError(true); setReport(null) }
      }
    }
    void load()
    const t = setInterval(load, POLL_MS)
    return () => { alive = false; clearInterval(t) }
  }, [])

  const color = !report || error ? 'var(--hud-dim)'
    : report.healthy  ? '#22c55e'
    : report.degraded ? '#f59e0b'
    : '#ef4444'

  const label = error ? 'sem conexão'
    : !report ? '…'
    : report.healthy  ? 'tudo ok'
    : report.degraded ? 'degradado'
    : 'crítico'

  return (
    <div
      style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'default' }}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, boxShadow: `0 0 6px ${color}` }} />
      <span style={{ fontSize: 11, color: 'var(--hud-text-2)' }}>JARVIS: {label}</span>

      {open && report && (
        <div className="hud-card" style={{ position: 'absolute', top: '130%', right: 0, zIndex: 30, padding: 10, width: 210, fontSize: 11 }}>
          {(['litellm', 'database', 'v1bridge'] as const).map((k) => {
            const s = report.services[k]
            return (
              <div key={k} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ color: 'var(--hud-text-2)' }}>
                  <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', marginRight: 6, background: s.ok ? '#22c55e' : '#ef4444' }} />
                  {SERVICE_LABELS[k]}
                </span>
                <span style={{ color: 'var(--hud-dim)', fontVariantNumeric: 'tabular-nums' }}>
                  {s.ok ? `${s.latencyMs}ms` : 'down'}
                </span>
              </div>
            )
          })}
          {report.blockedIntentTypes.length > 0 && (
            <div style={{ marginTop: 6, paddingTop: 6, borderTop: '1px solid var(--hud-border)', color: 'var(--hud-dim)' }}>
              {report.blockedIntentTypes.length} intenç{report.blockedIntentTypes.length === 1 ? 'ão' : 'ões'} indisponí{report.blockedIntentTypes.length === 1 ? 'vel' : 'veis'} agora
            </div>
          )}
        </div>
      )}
    </div>
  )
}
