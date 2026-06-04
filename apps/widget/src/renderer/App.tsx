import { useEffect, useState, useCallback, useRef } from 'react'
import { MissionList } from './components/MissionList'
import { VoiceBar } from './components/VoiceBar'

declare global {
  interface Window {
    rayzen: {
      minimize:      () => void
      close:         () => void
      onWsEvent:     (cb: (e: unknown) => void) => () => void
      fetchProjects: () => Promise<Project[]>
      fetchMissions: (projectId: string) => Promise<Mission[]>
      missionAction: (id: string, action: string) => Promise<unknown>
      openInBrowser: (missionId: string) => void
      launchClaude:  (projectPath: string, objective: string) => Promise<{ ok: boolean }>
      transcribe:    (buffer: ArrayBuffer) => Promise<string>
      sendChat:      (projectId: string, content: string, sessionId?: string) => Promise<ChatReply | null>
      getConfig:     () => Promise<{ apiUrl: string; projectId: string }>
    }
  }
}

export interface Project { id: string; name: string; status: string }

export type MissionStatus = 'pending' | 'active' | 'paused' | 'done' | 'failed' | 'cancelled'

export interface MissionStep { id: string; title: string; status: string; executor: string }

export interface Mission {
  id: string; title: string; objective: string
  status: MissionStatus; steps: MissionStep[]
  createdAt: string; startedAt: string | null; completedAt: string | null
}

interface ChatReply { sessionId: string; reply: string; status: string }

type Filter = 'ativas' | 'todas'

export function App() {
  const [projects, setProjects]     = useState<Project[]>([])
  const [projectId, setProjectId]   = useState<string>('')
  const [missions, setMissions]     = useState<Mission[]>([])
  const [filter, setFilter]         = useState<Filter>('ativas')
  const [wsOnline, setWsOnline]     = useState(false)
  const [loading, setLoading]       = useState(true)
  const [sending, setSending]       = useState(false)
  const [chatReply, setChatReply]   = useState<string | null>(null)
  const [sessionId, setSessionId]   = useState<string | undefined>()
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const wsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const loadMissions = useCallback(async (pid: string) => {
    if (!pid) return
    try {
      const list = await window.rayzen.fetchMissions(pid)
      setMissions(Array.isArray(list) ? list : [])
    } finally { setLoading(false) }
  }, [])

  // Initial load
  useEffect(() => {
    Promise.all([window.rayzen.getConfig(), window.rayzen.fetchProjects()])
      .then(([cfg, list]) => {
        const all = Array.isArray(list) ? list : []
        setProjects(all)
        const pid = cfg.projectId || all[0]?.id || ''
        setProjectId(pid)
        if (pid) void loadMissions(pid)
      })
  }, [loadMissions])

  // Poll while any mission active
  useEffect(() => {
    if (!projectId) return
    if (missions.some((m) => m.status === 'active')) {
      pollRef.current = setInterval(() => void loadMissions(projectId), 4000)
    } else {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
    }
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [missions, projectId, loadMissions])

  // WebSocket events
  useEffect(() => {
    const off = window.rayzen.onWsEvent((raw) => {
      const event = raw as { type: string }
      // Mark WS as online
      setWsOnline(true)
      if (wsTimerRef.current) clearTimeout(wsTimerRef.current)
      wsTimerRef.current = setTimeout(() => setWsOnline(false), 35_000)

      if (event.type === 'mission_update' || event.type === 'mission_created') {
        void loadMissions(projectId)
      }
    })
    return () => { off(); if (wsTimerRef.current) clearTimeout(wsTimerRef.current) }
  }, [projectId, loadMissions])

  const changeProject = (pid: string) => {
    setProjectId(pid)
    setMissions([])
    setLoading(true)
    setSessionId(undefined)
    setChatReply(null)
    void loadMissions(pid)
  }

  const handleAction = async (id: string, action: string) => {
    await window.rayzen.missionAction(id, action)
    await loadMissions(projectId)
  }

  const handleSendChat = async (text: string) => {
    if (!text.trim() || !projectId || sending) return
    setSending(true)
    setChatReply(null)
    try {
      const res = await window.rayzen.sendChat(projectId, text, sessionId)
      if (res) {
        setSessionId(res.sessionId)
        setChatReply(res.reply)
      }
    } finally { setSending(false) }
  }

  // Counts for summary
  const active  = missions.filter((m) => m.status === 'active').length
  const pending = missions.filter((m) => m.status === 'pending').length
  const done    = missions.filter((m) => m.status === 'done').length

  const activeProject = projects.find((p) => p.id === projectId)

  return (
    <div className="widget">
      {/* Titlebar */}
      <div className="titlebar">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
          <span style={{ color: 'var(--cyan)', fontWeight: 700, fontSize: 11, letterSpacing: 1, flexShrink: 0 }}>RAYZEN</span>
          <div
            className={`ws-dot ${wsOnline ? 'on' : 'off'}`}
            title={wsOnline ? 'conectado' : 'reconectando…'}
            style={{ flexShrink: 0 }}
          />
          {/* Project selector */}
          {projects.length > 0 && (
            <select
              value={projectId}
              onChange={(e) => changeProject(e.target.value)}
              style={{
                flex: 1, minWidth: 0, background: 'transparent', border: 'none',
                color: 'var(--text2)', fontSize: 11, cursor: 'pointer', outline: 'none',
                WebkitAppRegion: 'no-drag' as never,
              }}
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id} style={{ background: '#111118' }}>{p.name}</option>
              ))}
            </select>
          )}
          {projects.length === 0 && activeProject && (
            <span style={{ fontSize: 11, color: 'var(--text2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {activeProject.name}
            </span>
          )}
        </div>
        <div className="controls" style={{ flexShrink: 0 }}>
          <button className="btn-min"   onClick={() => window.rayzen.minimize()} title="minimizar" />
          <button className="btn-close" onClick={() => window.rayzen.close()}    title="fechar" />
        </div>
      </div>

      {/* Summary bar */}
      {!loading && missions.length > 0 && (
        <div style={{ display: 'flex', gap: 12, padding: '6px 12px', borderBottom: '1px solid var(--border)', fontSize: 11 }}>
          <span style={{ color: active  > 0 ? 'var(--cyan)'  : 'var(--dim)' }}>{active} ativa{active !== 1 ? 's' : ''}</span>
          <span style={{ color: pending > 0 ? 'var(--yellow)': 'var(--dim)' }}>{pending} pendente{pending !== 1 ? 's' : ''}</span>
          <span style={{ color: 'var(--dim)' }}>{done} concluída{done !== 1 ? 's' : ''}</span>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
            {(['ativas', 'todas'] as Filter[]).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer', fontSize: 10,
                  color: filter === f ? 'var(--cyan)' : 'var(--dim)',
                  padding: '0 2px', fontFamily: 'inherit',
                }}
              >
                {f}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Content */}
      <div className="content">
        {loading ? (
          <div style={{ color: 'var(--dim)', fontSize: 12, textAlign: 'center', paddingTop: 20 }}>carregando…</div>
        ) : (
          <MissionList
            missions={missions}
            filter={filter}
            onAction={handleAction}
            onWork={(m) => window.rayzen.openInBrowser(m.id)}
          />
        )}

        {/* Chat reply */}
        {chatReply && (
          <div className="card" style={{ fontSize: 12, color: 'var(--text2)', lineHeight: 1.5 }}>
            <div style={{ fontSize: 10, color: 'var(--cyan)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>Rayzen</div>
            {chatReply}
          </div>
        )}
      </div>

      {/* Input bar */}
      <VoiceBar
        sending={sending}
        onSend={handleSendChat}
      />
    </div>
  )
}
