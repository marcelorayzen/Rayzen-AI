'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import Link from 'next/link'
import { V2_URL, API_URL } from '../../lib/api-url'
import { authHeaders } from '../../lib/api-client'
import { HelpTip } from '../components/HelpTip'

type MissionStatus = 'pending' | 'active' | 'paused' | 'done' | 'failed' | 'cancelled'

interface MissionStep {
  id: string
  status: string
}

interface Mission {
  id: string
  projectId: string
  title: string
  objective: string
  status: MissionStatus
  specialistId: string | null
  createdAt: string
  startedAt: string | null
  completedAt: string | null
  steps: MissionStep[]
}

interface Project { id: string; name: string; status: string }

const STATUS_COLOR: Record<MissionStatus, string> = {
  pending:   'var(--hud-dim)',
  active:    'var(--hud-cyan)',
  paused:    '#facc15',
  done:      '#22c55e',
  failed:    '#ef4444',
  cancelled: 'var(--hud-text-2)',
}

const STATUS_LABEL: Record<MissionStatus, string> = {
  pending:   'pendente',
  active:    'ativa',
  paused:    'pausada',
  done:      'concluída',
  failed:    'falhou',
  cancelled: 'cancelada',
}

type Filter = 'all' | MissionStatus

function progressOf(steps: MissionStep[]): number {
  if (!steps.length) return 0
  const done = steps.filter((s) => s.status === 'done' || s.status === 'skipped').length
  return Math.round((done / steps.length) * 100)
}

function elapsed(from: string | null, to: string | null): string {
  if (!from) return '—'
  const ms = new Date(to ?? Date.now()).getTime() - new Date(from).getTime()
  const s = Math.floor(ms / 1000)
  if (s < 60)   return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`
}

export default function MissionPage() {
  const [projects, setProjects]       = useState<Project[]>([])
  const [projectId, setProjectId]     = useState<string | null>(null)
  const [missions, setMissions]       = useState<Mission[]>([])
  const [filter, setFilter]           = useState<Filter>('all')
  const [loading, setLoading]         = useState(true)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // load projects
  useEffect(() => {
    const saved = localStorage.getItem('rayzen_active_project_id')
    fetch(`${API_URL}/projects`, { headers: authHeaders() })
      .then((r) => r.json())
      .then((d: unknown) => {
        const list = Array.isArray(d) ? (d as Project[]) : []
        setProjects(list)
        const exists = saved && list.some((p) => p.id === saved)
        const pid = (exists ? saved : (list.find((p) => p.status === 'active') ?? list[0])?.id) ?? null
        setProjectId(pid)
        if (!pid) setLoading(false)
      })
      .catch(() => { setProjects([]); setLoading(false) })
  }, [])

  const load = useCallback(async (pid: string) => {
    try {
      const res = await fetch(`${V2_URL}/missions?projectId=${pid}`, { headers: authHeaders() })
      if (res.ok) setMissions(await res.json() as Mission[])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!projectId) return
    setLoading(true)
    void load(projectId)

    // poll while any mission is active
    pollRef.current = setInterval(() => void load(projectId), 5000)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [projectId, load])

  const selectProject = (id: string) => {
    setProjectId(id)
    localStorage.setItem('rayzen_active_project_id', id)
    setMissions([])
    setLoading(true)
  }

  const visible = missions.filter((m) => filter === 'all' || m.status === filter)

  const counts = {
    all:       missions.length,
    active:    missions.filter((m) => m.status === 'active').length,
    pending:   missions.filter((m) => m.status === 'pending').length,
    done:      missions.filter((m) => m.status === 'done').length,
    failed:    missions.filter((m) => m.status === 'failed').length,
    paused:    missions.filter((m) => m.status === 'paused').length,
    cancelled: missions.filter((m) => m.status === 'cancelled').length,
  }

  return (
    <div style={{ maxWidth: 860, margin: '0 auto', padding: '20px 16px', minHeight: '100vh', display: 'flex', flexDirection: 'column', gap: 14 }}>

      {/* Header */}
      <div className="hud-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span className="hud-title" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            MISSIONS
            <HelpTip title="Missões V2" side="bottom">
              Missões são objetivos estruturados com steps planejados pelo Router V2.<br /><br />
              <strong>Criar:</strong> clique em "+ nova missão" → descreva o objetivo em linguagem natural.<br />
              <strong>Executar:</strong> acesse a missão e clique em "executar".<br />
              <strong>Concluir:</strong> ao finalizar, gera síntese + atualiza o Brain automaticamente.
            </HelpTip>
          </span>
          <span style={{ color: 'var(--hud-dim)' }}>·</span>
          <select
            value={projectId ?? ''}
            onChange={(e) => selectProject(e.target.value)}
            className="hud-input"
            style={{ padding: '4px 8px', fontSize: 13 }}
          >
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Link href="/work-panel" className="hud-btn hud-btn-primary" style={{ fontSize: 12 }}>+ nova missão</Link>
          <Link href="/" className="hud-btn" style={{ fontSize: 12 }}>← painel</Link>
        </div>
      </div>

      {/* Stats */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {(['all', 'active', 'pending', 'done', 'failed'] as const).map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className="hud-btn"
            style={{
              fontSize: 11,
              borderColor: filter === s ? (s === 'all' ? 'var(--hud-cyan)' : STATUS_COLOR[s as MissionStatus]) : undefined,
              color: filter === s ? (s === 'all' ? 'var(--hud-cyan)' : STATUS_COLOR[s as MissionStatus]) : undefined,
            }}
          >
            {s === 'all' ? 'todas' : STATUS_LABEL[s as MissionStatus]} · {counts[s]}
          </button>
        ))}
      </div>

      {/* List */}
      {loading && <div className="hud-pulse" style={{ color: 'var(--hud-dim)', fontSize: 13 }}>carregando…</div>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {visible.map((m) => {
          const pct = progressOf(m.steps)
          const color = STATUS_COLOR[m.status]
          return (
            <Link key={m.id} href={`/mission/${m.id}`} style={{ textDecoration: 'none' }}>
              <div className="hud-card" style={{ padding: '12px 14px', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 6 }}>
                {/* Row 1: title + status */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{ fontWeight: 600, fontSize: 14 }}>{m.title}</span>
                  <span style={{
                    fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 3,
                    border: `1px solid ${color}`, color,
                    flexShrink: 0,
                  }}>
                    {STATUS_LABEL[m.status].toUpperCase()}
                  </span>
                </div>

                {/* Row 2: objective */}
                <div style={{ fontSize: 12, color: 'var(--hud-text-2)', lineHeight: 1.4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {m.objective}
                </div>

                {/* Row 3: progress bar + meta */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  {m.steps.length > 0 && (
                    <div style={{ flex: 1, height: 3, background: 'var(--hud-surface)', borderRadius: 2, overflow: 'hidden' }}>
                      <div style={{ width: `${pct}%`, height: '100%', background: color, transition: 'width 0.3s' }} />
                    </div>
                  )}
                  <span style={{ fontSize: 11, color: 'var(--hud-dim)', whiteSpace: 'nowrap' }}>
                    {m.steps.length > 0 ? `${m.steps.filter((s) => s.status === 'done').length}/${m.steps.length} steps` : 'sem steps'}
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--hud-dim)' }}>
                    {elapsed(m.startedAt, m.completedAt)}
                  </span>
                </div>
              </div>
            </Link>
          )
        })}
      </div>

      {!loading && visible.length === 0 && (
        <div style={{ textAlign: 'center', color: 'var(--hud-dim)', marginTop: 60, fontSize: 13 }}>
          {filter === 'all' ? 'Nenhuma missão criada ainda.' : `Nenhuma missão ${STATUS_LABEL[filter as MissionStatus]}.`}
          <br /><br />
          <Link href="/work-panel" className="hud-btn hud-btn-primary" style={{ fontSize: 12 }}>Criar primeira missão</Link>
        </div>
      )}
    </div>
  )
}
