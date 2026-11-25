'use client'

import { useEffect, useState } from 'react'
import { V2_URL } from '../../../lib/api-url'
import { authHeaders } from '../../../lib/api-client'

export interface ContextPreview {
  totalChars: number
  estimatedTokens: number
  sectionsIncluded: string[]
  cacheHit?: boolean
}

const SECTION_LABELS: Record<string, string> = {
  project_state:   'estado',
  active_goal:     'meta',
  recent_events:   'atividade',
  memory_relevant: 'memória',
  planning:        'planejamento',
  blockers:        'blockers',
}

/**
 * Mostra o snapshot de contexto comprimido que o Rayzen injetaria no agente
 * para a intenção atual — transparência da economia de tokens (Context Broker).
 */
export function ContextBadge({
  projectId,
  query,
  mode = 'architecture',
}: {
  projectId: string | null
  query: string
  mode?: string
}) {
  const [preview, setPreview] = useState<ContextPreview | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!projectId) { setPreview(null); return }
    const handle = setTimeout(async () => {
      setLoading(true)
      try {
        const params = new URLSearchParams({ projectId, mode })
        if (query.trim()) params.set('query', query.trim())
        const res = await fetch(`${V2_URL}/context/preview?${params.toString()}`, { headers: authHeaders() })
        if (res.ok) setPreview(await res.json() as ContextPreview)
      } catch { /* silencioso — badge é informativo */ }
      finally { setLoading(false) }
    }, 600)
    return () => clearTimeout(handle)
  }, [projectId, query, mode])

  if (!projectId) return null

  return (
    <div className="hud-card" style={{ padding: '10px 12px', fontSize: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <span style={{ color: 'var(--hud-text-2)', textTransform: 'uppercase', letterSpacing: 0.5, fontSize: 10 }}>
          Contexto comprimido
        </span>
        <span style={{ color: 'var(--hud-cyan)', fontVariantNumeric: 'tabular-nums' }}>
          {loading ? '…' : `≈${preview?.estimatedTokens ?? 0} tokens`}
        </span>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        {(preview?.sectionsIncluded ?? []).length === 0 && !loading && (
          <span style={{ color: 'var(--hud-dim)' }}>sem contexto disponível</span>
        )}
        {(preview?.sectionsIncluded ?? []).map((s) => (
          <span
            key={s}
            style={{
              padding: '2px 7px',
              borderRadius: 4,
              background: 'var(--hud-cyan-10)',
              border: '1px solid var(--hud-cyan-20)',
              color: 'var(--hud-text)',
            }}
          >
            {SECTION_LABELS[s] ?? s}
          </span>
        ))}
      </div>
      {preview && preview.totalChars > 0 && (
        <div style={{ marginTop: 6, color: 'var(--hud-dim)', fontSize: 11 }}>
          {preview.totalChars} caracteres serão injetados no prompt do agente — sem re-explicar o projeto.
        </div>
      )}
    </div>
  )
}
