import { useEffect, useState, useCallback, useRef } from 'react'
import { MissionList } from './components/MissionList'
import { VoiceBar } from './components/VoiceBar'

declare global {
  interface Window {
    rayzen: {
      minimize: () => void
      close: () => void
      onWsEvent: (cb: (e: unknown) => void) => () => void
      fetchMissions: (projectId: string) => Promise<Mission[]>
      missionAction: (id: string, action: string) => Promise<unknown>
      openInBrowser: (missionId: string) => void
      launchClaude: (projectPath: string, objective: string) => Promise<{ ok: boolean; pid?: number; error?: string }>
      transcribe: (buffer: ArrayBuffer) => Promise<string>
      getConfig: () => Promise<{ apiUrl: string; projectId: string }>
    }
  }
}

export type MissionStatus = 'pending' | 'active' | 'paused' | 'done' | 'failed' | 'cancelled'

export interface MissionStep {
  id: string; title: string; status: string; executor: string
}

export interface Mission {
  id: string; title: string; objective: string
  status: MissionStatus; steps: MissionStep[]
  createdAt: string; startedAt: string | null; completedAt: string | null
}

export function App() {
  const [missions, setMissions]     = useState<Mission[]>([])
  const [projectId, setProjectId]   = useState<string>('')
  const [wsOnline, setWsOnline]     = useState(false)
  const [loading, setLoading]       = useState(true)
  const [inputText, setInputText]   = useState('')
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const loadMissions = useCallback(async (pid: string) => {
    if (!pid) return
    try {
      const list = await window.rayzen.fetchMissions(pid)
      setMissions(list)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    window.rayzen.getConfig().then(({ projectId: pid }) => {
      setProjectId(pid)
      void loadMissions(pid)
    })
  }, [loadMissions])

  // Poll while any mission is active
  useEffect(() => {
    if (!projectId) return
    const hasActive = missions.some((m) => m.status === 'active')
    if (hasActive) {
      pollRef.current = setInterval(() => void loadMissions(projectId), 4000)
    } else {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
    }
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [missions, projectId, loadMissions])

  // WebSocket events
  useEffect(() => {
    const off = window.rayzen.onWsEvent((raw) => {
      const event = raw as { type: string; payload: unknown }
      setWsOnline(true)

      if (event.type === 'mission_update' || event.type === 'mission_created') {
        void loadMissions(projectId)
      }
    })

    // Heartbeat: se chegar ping, ws está on
    const t = setInterval(() => setWsOnline(false), 35_000)
    return () => { off(); clearInterval(t) }
  }, [projectId, loadMissions])

  const handleAction = async (id: string, action: string) => {
    await window.rayzen.missionAction(id, action)
    await loadMissions(projectId)
  }

  const handleWork = (mission: Mission) => {
    // Open in browser work-panel with mission pre-loaded
    window.rayzen.openInBrowser(mission.id)
  }

  const handleTranscript = (text: string) => {
    setInputText((prev) => prev ? `${prev} ${text}` : text)
  }

  return (
    <div className="widget">
      {/* Titlebar */}
      <div className="titlebar">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ color: 'var(--cyan)', fontWeight: 700, fontSize: 11, letterSpacing: 1 }}>RAYZEN</span>
          <div className={`ws-dot ${wsOnline ? 'on' : 'off'}`} title={wsOnline ? 'conectado' : 'reconectando…'} />
        </div>
        <div className="controls">
          <button className="btn-min" onClick={() => window.rayzen.minimize()} title="minimizar" />
          <button className="btn-close" onClick={() => window.rayzen.close()} title="fechar" />
        </div>
      </div>

      {/* Content */}
      <div className="content">
        <div className="section-label">missões</div>
        {loading
          ? <div style={{ color: 'var(--dim)', fontSize: 12 }}>carregando…</div>
          : <MissionList
              missions={missions}
              onAction={handleAction}
              onWork={handleWork}
            />
        }
      </div>

      {/* Bottom bar — voice + input */}
      <VoiceBar
        value={inputText}
        onChange={setInputText}
        onTranscript={handleTranscript}
      />
    </div>
  )
}
