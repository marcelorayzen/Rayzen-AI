import { useEffect, useState, useCallback, useRef } from 'react'
import { MissionList } from './components/MissionList'
import { VoiceBar } from './components/VoiceBar'
import { InfraHealth, type InfraHealthReport } from './components/InfraHealth'

declare global {
  interface Window {
    rayzen: {
      minimize:         () => void
      close:         () => void
      onWsEvent:     (cb: (e: unknown) => void) => () => void
      fetchProjects: () => Promise<Project[]>
      fetchMissions: (projectId: string) => Promise<Mission[]>
      missionAction: (id: string, action: string) => Promise<unknown>
      openInBrowser: (missionId: string) => void
      launchClaude:  (repoSlug: string, objective: string) => Promise<{ ok: boolean }>
      claudeChat:         (projectId: string, message: string, context?: { projectName: string; activeMissions: { title: string; objective: string; status: string }[] }, model?: string) => Promise<void>
      onClaudeChunk:      (cb: (chunk: { text: string; done: boolean; error?: string }) => void) => () => void
      clearClaudeHistory: (projectId: string) => void
      transcribe:    (buffer: ArrayBuffer) => Promise<string>
      sendChat:      (projectId: string, content: string, sessionId?: string) => Promise<ChatReply | null>
      fetchInfraHealth: () => Promise<InfraHealthReport | null>
      getConfig:     () => Promise<{ apiUrl: string; projectId: string; localRoot?: string }>
      getWsStatus:   () => Promise<boolean>
      notifyReady:   () => void
    }
  }
}

export interface Project { id: string; name: string; status: string; repoSlug?: string | null }

export type MissionStatus = 'pending' | 'active' | 'paused' | 'done' | 'failed' | 'cancelled'

export interface MissionStep { id: string; title: string; status: string; executor: string }

export interface Mission {
  id: string; title: string; objective: string
  status: MissionStatus; steps: MissionStep[]
  createdAt: string; startedAt: string | null; completedAt: string | null
}

interface ChatReply { sessionId: string; reply: string; status: string }

type Filter    = 'ativas' | 'todas'
type ChatMode  = 'rayzen' | 'claude'

export function App() {
  const [projects, setProjects]     = useState<Project[]>([])
  const [projectId, setProjectId]   = useState<string>('')
  const [localRoot, setLocalRoot]   = useState<string>('')
  const [missions, setMissions]     = useState<Mission[]>([])
  const [filter, setFilter]         = useState<Filter>('ativas')
  const [wsOnline, setWsOnline]     = useState(false)
  const [loading, setLoading]       = useState(true)
  const [sending, setSending]       = useState(false)
  const [chatReply, setChatReply]   = useState<string | null>(null)
  const [sessionId, setSessionId]   = useState<string | undefined>()
  const [chatMode, setChatMode]     = useState<ChatMode>('claude')
  const [claudeModel, setClaudeModel] = useState('claude-haiku-4-5-20251001')
  const [streaming, setStreaming]   = useState(false)
  const [infraHealth, setInfraHealth]   = useState<InfraHealthReport | null>(null)
  const [infraCheckedAt, setInfraCheckedAt] = useState(0)   // Date.now() when last checked
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const wsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const infraPollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const loadMissions = useCallback(async (pid: string) => {
    if (!pid) return
    try {
      const list = await window.rayzen.fetchMissions(pid)
      setMissions(Array.isArray(list) ? list : [])
    } finally { setLoading(false) }
  }, [])

  // Streaming chunks do Claude
  useEffect(() => {
    const off = window.rayzen.onClaudeChunk((chunk) => {
      if (chunk.error) {
        setChatReply(`Erro: ${chunk.error}`)
        setSending(false)
        setStreaming(false)
        return
      }
      if (chunk.done) {
        setSending(false)
        setStreaming(false)
        return
      }
      setChatReply((prev) => (prev ?? '') + chunk.text)
      setStreaming(true)
    })
    return off
  }, [])

  // Infra health polling
  useEffect(() => {
    const check = () => {
      window.rayzen.fetchInfraHealth().then((r) => {
        if (r) { setInfraHealth(r); setInfraCheckedAt(Date.now()) }
      }).catch(() => null)
    }
    check()
    infraPollRef.current = setInterval(check, 30_000)
    return () => { if (infraPollRef.current) clearInterval(infraPollRef.current) }
  }, [])

  // Initial load
  useEffect(() => {
    // Avisa o main que o renderer está pronto (resolve timing do ws:connected)
    window.rayzen.notifyReady()

    // Pega status atual do WebSocket
    window.rayzen.getWsStatus().then((connected) => setWsOnline(connected))

    Promise.all([window.rayzen.getConfig(), window.rayzen.fetchProjects()])
      .then(([cfg, list]) => {
        const all = Array.isArray(list) ? list : []
        setProjects(all)
        setLocalRoot(cfg.localRoot ?? '')
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
      setWsOnline(true)
      if (wsTimerRef.current) clearTimeout(wsTimerRef.current)
      // Reset to offline after 35s of silence (except on 'connected' we keep longer)
      wsTimerRef.current = setTimeout(() => setWsOnline(false), event.type === 'connected' ? 120_000 : 35_000)

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
    const res = await window.rayzen.missionAction(id, action)
    if (!res) {
      setChatReply('Erro: API não respondeu. Verifique a conexão.')
      return
    }
    await loadMissions(projectId)
  }

  const handleSendChat = async (text: string) => {
    if (!text.trim() || sending || streaming) return
    setChatReply(null)

    if (chatMode === 'claude') {
      setSending(true)
      const activeProj = projects.find((p) => p.id === projectId)
      const context = activeProj ? {
        projectName:    activeProj.name,
        activeMissions: missions
          .filter((m) => m.status === 'active' || m.status === 'pending')
          .map((m) => ({ title: m.title, objective: m.objective, status: m.status })),
      } : undefined
      // Não awaita — resposta chega via onClaudeChunk (streaming)
      // setSending(false) é chamado pelo listener quando chunk.done = true
      window.rayzen.claudeChat(projectId, text, context, claudeModel).catch((err: unknown) => {
        setChatReply(`Erro: ${err instanceof Error ? err.message : String(err)}`)
        setSending(false)
        setStreaming(false)
      })
    } else {
      if (!projectId) return
      setSending(true)
      try {
        const res = await window.rayzen.sendChat(projectId, text, sessionId)
        if (res) {
          setSessionId(res.sessionId)
          setChatReply(res.reply)
        }
      } finally { setSending(false) }
    }
  }

  // Seconds since last infra check
  const checkedAgo = infraCheckedAt ? Math.floor((Date.now() - infraCheckedAt) / 1000) : 0

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

      {/* Infra health bar */}
      <InfraHealth report={infraHealth} checkedAgo={checkedAgo} />

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
            onWork={(m) => {
              const activeProj = projects.find((p) => p.id === projectId)
              const repoSlug   = activeProj?.repoSlug
              if (localRoot && repoSlug) {
                window.rayzen.launchClaude(repoSlug, m.objective || m.title)
                  .then((res) => { if (!res?.ok) window.rayzen.openInBrowser(m.id) })
                  .catch(() => window.rayzen.openInBrowser(m.id))
              } else {
                window.rayzen.openInBrowser(m.id)
              }
            }}
          />
        )}

        {/* Chat reply */}
        {chatReply && (
          <div className="card" style={{ fontSize: 12, color: 'var(--text2)', lineHeight: 1.5 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
              <div style={{ fontSize: 10, color: chatMode === 'claude' ? 'var(--cyan)' : 'var(--yellow)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                {chatMode === 'claude' ? 'Claude' : 'Rayzen'}
                {streaming && <span style={{ marginLeft: 4, opacity: 0.6 }}>▍</span>}
              </div>
              {!streaming && chatMode === 'claude' && (
                <button
                  onClick={() => { window.rayzen.clearClaudeHistory(projectId); setChatReply(null) }}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 9, color: 'var(--dim)', fontFamily: 'inherit' }}
                  title="limpar conversa"
                >
                  limpar
                </button>
              )}
            </div>
            <div style={{ whiteSpace: 'pre-wrap' }}>{chatReply}</div>
          </div>
        )}
      </div>

      {/* Input bar */}
      <VoiceBar
        sending={sending || streaming}
        onSend={handleSendChat}
        chatMode={chatMode}
        onModeChange={(mode) => { setChatMode(mode); setChatReply(null) }}
        claudeModel={claudeModel}
        onModelChange={setClaudeModel}
      />
    </div>
  )
}
