'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { V2_URL } from '../../lib/api-url'
import { authHeaders } from '../../lib/api-client'

interface CatalogEntry {
  catalogId:     string | null
  v1ProjectId:   string
  name:          string
  repoSlug:      string | null
  description:   string | null
  owner:         string | null
  provenance:    string
  tags:          string[]
  healthScore:   number | null
  missionCount:  number
  lastMissionAt: string | null
  archivedAt:    string | null
  updatedAt:     string | null
}

const PROVENANCE_LABEL: Record<string, string> = {
  manual:    'manual',
  blueprint: 'blueprint',
  discovery: 'discovery',
  import:    'import',
}

const PROVENANCE_COLOR: Record<string, string> = {
  manual:    'var(--hud-dim)',
  blueprint: 'var(--hud-cyan)',
  discovery: '#a78bfa',
  import:    '#fb923c',
}

function HealthBadge({ score }: { score: number | null }) {
  if (score === null) return <span style={{ color: 'var(--hud-dim)', fontSize: 11 }}>—</span>
  const color = score >= 80 ? '#22c55e' : score >= 50 ? '#facc15' : '#ef4444'
  return <span style={{ color, fontSize: 12, fontWeight: 600 }}>{Math.round(score)}%</span>
}

export default function CatalogPage() {
  const [entries, setEntries]     = useState<CatalogEntry[]>([])
  const [loading, setLoading]     = useState(true)
  const [editing, setEditing]     = useState<string | null>(null)
  const [editOwner, setEditOwner] = useState('')
  const [editProv, setEditProv]   = useState('manual')
  const [editTags, setEditTags]   = useState('')
  const [saving, setSaving]       = useState(false)
  const [note, setNote]           = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${V2_URL}/catalog`, { headers: authHeaders() })
      if (res.ok) setEntries(await res.json() as CatalogEntry[])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const startEdit = (e: CatalogEntry) => {
    setEditing(e.v1ProjectId)
    setEditOwner(e.owner ?? '')
    setEditProv(e.provenance)
    setEditTags(e.tags.join(', '))
    setNote(null)
  }

  const saveEdit = async () => {
    if (!editing || saving) return
    setSaving(true)
    try {
      const res = await fetch(`${V2_URL}/catalog/${editing}`, {
        method: 'PUT',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          owner:      editOwner.trim() || null,
          provenance: editProv,
          tags:       editTags.split(',').map((t) => t.trim()).filter(Boolean),
        }),
      })
      if (!res.ok) { setNote(`Erro ${res.status}`); return }
      setEditing(null)
      await load()
    } catch (err) {
      setNote(err instanceof Error ? err.message : 'erro ao salvar')
    } finally {
      setSaving(false)
    }
  }

  const visible = entries.filter((e) => !e.archivedAt)

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '20px 16px', minHeight: '100vh', display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Header */}
      <div className="hud-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span className="hud-title">CATALOG</span>
        <div style={{ display: 'flex', gap: 8 }}>
          <Link href="/work-panel" className="hud-btn" style={{ fontSize: 12 }}>work panel</Link>
          <Link href="/" className="hud-btn" style={{ fontSize: 12 }}>← painel</Link>
        </div>
      </div>

      <div style={{ fontSize: 12, color: 'var(--hud-dim)' }}>
        {visible.length} projeto{visible.length !== 1 ? 's' : ''} ativos
      </div>

      {loading && <div className="hud-pulse" style={{ color: 'var(--hud-dim)', fontSize: 13 }}>carregando…</div>}
      {note && <div style={{ color: '#ef4444', fontSize: 12 }}>{note}</div>}

      {/* Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(380px, 1fr))', gap: 12 }}>
        {visible.map((e) => (
          <div key={e.v1ProjectId} className="hud-card" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {/* Top row */}
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{e.name}</div>
                {e.repoSlug && <div style={{ fontSize: 11, color: 'var(--hud-dim)', marginTop: 1 }}>{e.repoSlug}</div>}
              </div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
                <span style={{
                  fontSize: 10, padding: '2px 6px', borderRadius: 3,
                  border: `1px solid ${PROVENANCE_COLOR[e.provenance] ?? 'var(--hud-dim)'}`,
                  color: PROVENANCE_COLOR[e.provenance] ?? 'var(--hud-dim)',
                }}>
                  {PROVENANCE_LABEL[e.provenance] ?? e.provenance}
                </span>
                <HealthBadge score={e.healthScore} />
              </div>
            </div>

            {e.description && (
              <div style={{ fontSize: 12, color: 'var(--hud-text-2)', lineHeight: 1.4 }}>{e.description}</div>
            )}

            {/* Edit form */}
            {editing === e.v1ProjectId ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingTop: 4 }}>
                <input className="hud-input" placeholder="owner" value={editOwner} onChange={(ev) => setEditOwner(ev.target.value)} style={{ fontSize: 12 }} />
                <select className="hud-input" value={editProv} onChange={(ev) => setEditProv(ev.target.value)} style={{ fontSize: 12 }}>
                  {Object.keys(PROVENANCE_LABEL).map((k) => <option key={k} value={k}>{k}</option>)}
                </select>
                <input className="hud-input" placeholder="tags (vírgula)" value={editTags} onChange={(ev) => setEditTags(ev.target.value)} style={{ fontSize: 12 }} />
                <div style={{ display: 'flex', gap: 6 }}>
                  <button className="hud-btn hud-btn-primary" onClick={saveEdit} disabled={saving} style={{ fontSize: 12 }}>{saving ? 'salvando…' : 'salvar'}</button>
                  <button className="hud-btn" onClick={() => setEditing(null)} style={{ fontSize: 12 }}>cancelar</button>
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 2 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  {e.owner && <span style={{ fontSize: 11, color: 'var(--hud-text-2)' }}>👤 {e.owner}</span>}
                  {e.tags.map((t) => (
                    <span key={t} style={{ fontSize: 10, padding: '1px 5px', borderRadius: 3, background: 'var(--hud-surface)', color: 'var(--hud-text-2)' }}>{t}</span>
                  ))}
                  <span style={{ fontSize: 11, color: 'var(--hud-dim)' }}>{e.missionCount} missão{e.missionCount !== 1 ? 'ões' : ''}</span>
                </div>
                <button className="hud-btn" onClick={() => startEdit(e)} style={{ fontSize: 11 }}>editar</button>
              </div>
            )}
          </div>
        ))}
      </div>

      {!loading && visible.length === 0 && (
        <div className="hud-empty" style={{ textAlign: 'center', color: 'var(--hud-dim)', marginTop: 40 }}>
          Nenhum projeto ativo encontrado.
        </div>
      )}
    </div>
  )
}
