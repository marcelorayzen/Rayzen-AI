'use client'

import { useCallback, useEffect, useRef, useState, useLayoutEffect, Suspense } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { API_URL, V2_URL } from '../../lib/api-url'
import { authHeaders } from '../../lib/api-client'
import { ContextBadge } from './components/ContextBadge'
import { ApprovalCard } from './components/ApprovalCard'
import { useVoiceInput } from '../hooks/useVoiceInput'

interface Project { id: string; name: string; status: string }

interface FeedMessage { role: 'user' | 'assistant'; content: string }

type StepStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped'
interface MissionStep { id: string; title: string; status: StepStatus; executor: string }
interface Mission { id: string; title: string; objective: string; status: string; steps: MissionStep[] }

interface SupervisedSession {
  id: string
  status: 'active' | 'waiting' | 'completed' | 'error'
  pendingQuestion: string | null
  pendingRequiresApproval: boolean
  pendingApprovalOptions: string[] | null
  summary: string | null
  previewUrl: string | null
  liveLog: string | null
}

interface ChatMessageResponse {
  sessionId: string
  reply: string
  status: 'gathering' | 'ready' | 'executing' | 'done'
  readyToExecute: boolean
  refinedObjective?: string
}

interface RouteResult {
  type: 'mission' | 'skill' | 'ai' | 'clarification'
  reasoning: string
  payload: { missionId?: string; note?: string; question?: string }
  result?: Mission | { answer?: string }
}

interface ExecuteResponse {
  sessionId: string
  contextPreview: { estimatedTokens: number; sectionsIncluded: string[]; totalChars: number }
  route: RouteResult
}

const STEP_COLOR: Record<StepStatus, string> = {
  pending: 'var(--hud-dim)',
  running: 'var(--hud-cyan)',
  done:    '#22c55e',
  failed:  '#ef4444',
  skipped: 'var(--hud-text-2)',
}

/** Lê ?session=<id> da URL e dispara o carregamento — precisa de Suspense no pai. */
function SessionParamLoader({ onSession }: { onSession: (s: SupervisedSession) => void }) {
  const searchParams = useSearchParams()
  useEffect(() => {
    const id = searchParams.get('session')
    if (!id) return
    fetch(`${API_URL}/agent/session/${id}`, { headers: authHeaders() })
      .then((r) => r.ok ? r.json() : null)
      .then((data: SupervisedSession | null) => { if (data) onSession(data) })
      .catch(() => null)
  }, [searchParams, onSession])
  return null
}

/** Lê ?mission=<id> e pré-carrega o objetivo da missão no input. */
function MissionParamLoader({ onMission }: { onMission: (objective: string) => void }) {
  const searchParams = useSearchParams()
  useEffect(() => {
    const id = searchParams.get('mission')
    if (!id) return
    fetch(`${V2_URL}/missions/${id}`, { headers: authHeaders() })
      .then((r) => r.ok ? r.json() : null)
      .then((data: { objective?: string; title?: string } | null) => {
        if (data?.objective) onMission(data.objective)
      })
      .catch(() => null)
  }, [searchParams, onMission])
  return null
}

export default function WorkPanelPage() {
  const [projects, setProjects] = useState<Project[]>([])
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null)
  const [feed, setFeed] = useState<FeedMessage[]>([])
  const [input, setInput] = useState('')
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [readyToExecute, setReadyToExecute] = useState(false)
  const [refinedObjective, setRefinedObjective] = useState<string | undefined>()
  const [sending, setSending] = useState(false)
  const [executing, setExecuting] = useState(false)
  const [mission, setMission] = useState<Mission | null>(null)
  const [runningWorkflow, setRunningWorkflow] = useState(false)
  const [supSession, setSupSession] = useState<SupervisedSession | null>(null)
  const [launchingAssisted, setLaunchingAssisted] = useState(false)
  const [replyingApproval, setReplyingApproval] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  const { state: voiceState, start: startVoice, stop: stopVoice, error: voiceError } = useVoiceInput(
    (text) => setInput((prev) => prev ? `${prev} ${text}` : text),
  )

  const feedEndRef = useRef<HTMLDivElement>(null)
  const logEndRef  = useRef<HTMLDivElement>(null)

  // Carrega projetos e restaura o projeto ativo do localStorage (mesma chave do painel principal)
  useEffect(() => {
    const saved = localStorage.getItem('rayzen_active_project_id')
    fetch(`${API_URL}/projects`, { headers: authHeaders() })
      .then((r) => r.json())
      .then((d: unknown) => {
        const list = Array.isArray(d) ? (d as Project[]) : []
        setProjects(list)
        const exists = saved && list.some((p) => p.id === saved)
        setActiveProjectId(exists ? saved : (list.find((p) => p.status === 'active') ?? list[0])?.id ?? null)
      })
      .catch(() => setProjects([]))
  }, [])

  useEffect(() => {
    feedEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [feed])

  // Auto-scroll do terminal ao vivo — síncrono para não piscar
  useLayoutEffect(() => {
    const el = logEndRef.current?.parentElement
    if (el) el.scrollTop = el.scrollHeight
  }, [supSession?.liveLog])

  const selectProject = useCallback((id: string) => {
    setActiveProjectId(id)
    localStorage.setItem('rayzen_active_project_id', id)
    // troca de projeto reinicia a conversa
    setSessionId(null); setFeed([]); setMission(null); setReadyToExecute(false); setRefinedObjective(undefined)
  }, [])

  const sendMessage = useCallback(async () => {
    if (!activeProjectId || !input.trim() || sending) return
    const content = input.trim()
    setInput('')
    setFeed((f) => [...f, { role: 'user', content }])
    setSending(true)
    setNote(null)
    try {
      const res = await fetch(`${V2_URL}/chat/message`, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ projectId: activeProjectId, content, sessionId: sessionId ?? undefined }),
      })
      if (!res.ok) { setNote(`Erro ao enviar (HTTP ${res.status})`); return }
      const data = await res.json() as ChatMessageResponse
      setSessionId(data.sessionId)
      setReadyToExecute(data.readyToExecute)
      setRefinedObjective(data.refinedObjective)
      setFeed((f) => [...f, { role: 'assistant', content: data.reply }])
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'falha ao enviar')
    } finally { setSending(false) }
  }, [activeProjectId, input, sessionId, sending])

  const pollMission = useCallback(async (id: string) => {
    try {
      const res = await fetch(`${V2_URL}/missions/${id}`, { headers: authHeaders() })
      if (res.ok) setMission(await res.json() as Mission)
    } catch { /* silencioso */ }
  }, [])

  const execute = useCallback(async () => {
    if (!sessionId || executing) return
    setExecuting(true)
    setNote(null)
    try {
      const res = await fetch(`${V2_URL}/chat/execute`, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ sessionId }),
      })
      if (!res.ok) { setNote(`Erro ao executar (HTTP ${res.status})`); return }
      const data = await res.json() as ExecuteResponse
      const route = data.route
      if (route.type === 'mission' && route.result && 'steps' in route.result) {
        setMission(route.result)
        setFeed((f) => [...f, { role: 'assistant', content: `Missão criada com ${route.result && 'steps' in route.result ? route.result.steps.length : 0} etapas. Contexto comprimido: ≈${data.contextPreview.estimatedTokens} tokens.` }])
      } else if (route.type === 'ai' && route.result && 'answer' in route.result) {
        setFeed((f) => [...f, { role: 'assistant', content: route.result && 'answer' in route.result ? (route.result.answer ?? '') : '' }])
      } else {
        setFeed((f) => [...f, { role: 'assistant', content: route.payload.question ?? route.payload.note ?? route.reasoning }])
      }
      setReadyToExecute(false)
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'falha ao executar')
    } finally { setExecuting(false) }
  }, [sessionId, executing])

  const runWorkflow = useCallback(async () => {
    if (!mission || !activeProjectId || runningWorkflow) return
    setRunningWorkflow(true)
    try {
      await fetch(`${V2_URL}/workflows/missions/${mission.id}/execute`, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ projectId: activeProjectId }),
      })
    } catch { /* silencioso */ }
    finally {
      setRunningWorkflow(false)
      await pollMission(mission.id)
    }
  }, [mission, activeProjectId, runningWorkflow, pollMission])

  // Polling enquanto a missão está rodando
  useEffect(() => {
    if (!mission || mission.status !== 'active') return
    const t = setInterval(() => void pollMission(mission.id), 3000)
    return () => clearInterval(t)
  }, [mission, pollMission])

  // ===== Sessão supervisionada (Claude Code real, com aprovação por etapa) =====
  const launchAssisted = useCallback(async () => {
    if (!activeProjectId || launchingAssisted) return
    const prompt = (refinedObjective ?? feed.filter((m) => m.role === 'user').at(-1)?.content ?? '').trim()
    if (!prompt) { setNote('Converse primeiro para definir o objetivo'); return }
    setLaunchingAssisted(true)
    setNote(null)
    try {
      // Broker → Claude real: monta o contexto comprimido e injeta no prompt da sessão
      let contextText = ''
      try {
        const cres = await fetch(`${V2_URL}/context/build`, {
          method: 'POST',
          headers: authHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ projectId: activeProjectId, query: prompt, mode: 'implementation' }),
        })
        if (cres.ok) contextText = ((await cres.json()) as { text?: string }).text ?? ''
      } catch { /* contexto é melhoria, não bloqueia */ }

      const enrichedPrompt = contextText
        ? `## Contexto do projeto (fornecido pelo Rayzen — use, não re-explique)\n${contextText}\n\n## Tarefa\n${prompt}`
        : prompt

      const res = await fetch(`${API_URL}/agent/session`, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ projectId: activeProjectId, prompt: enrichedPrompt }),
      })
      if (!res.ok) { setNote(`Erro ao iniciar sessão assistida (HTTP ${res.status})`); return }
      const data = await res.json() as SupervisedSession
      setSupSession(data)
      setFeed((f) => [...f, { role: 'assistant', content: 'Sessão assistida iniciada — o Claude Code está executando. Vou pausar a cada etapa para sua aprovação.' }])
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'falha ao iniciar sessão assistida')
    } finally { setLaunchingAssisted(false) }
  }, [activeProjectId, launchingAssisted, refinedObjective, feed])

  const answerApproval = useCallback(async (reply: string) => {
    if (!supSession || replyingApproval) return
    setReplyingApproval(true)
    // otimista: limpa a pergunta para esconder o card até o próximo poll
    setSupSession((s) => s ? { ...s, status: 'active', pendingQuestion: null } : s)
    try {
      await fetch(`${API_URL}/agent/session/${supSession.id}/answer`, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ reply }),
      })
    } catch { /* o poll reconcilia */ }
    finally { setReplyingApproval(false) }
  }, [supSession, replyingApproval])

  // Polling da sessão supervisionada enquanto ativa/aguardando
  useEffect(() => {
    if (!supSession || (supSession.status !== 'active' && supSession.status !== 'waiting')) return
    const id = supSession.id
    const t = setInterval(async () => {
      try {
        const res = await fetch(`${API_URL}/agent/session/${id}`, { headers: authHeaders() })
        if (res.ok) setSupSession(await res.json() as SupervisedSession)
      } catch { /* silencioso */ }
    }, 3000)
    return () => clearInterval(t)
  }, [supSession])

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: '20px 16px', minHeight: '100vh', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Suspense fallback={null}><SessionParamLoader onSession={setSupSession} /></Suspense>
      <Suspense fallback={null}><MissionParamLoader onMission={(obj) => setInput(obj)} /></Suspense>
      {/* Header */}
      <div className="hud-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span className="hud-title">RAYZEN</span>
          <span style={{ color: 'var(--hud-dim)' }}>·</span>
          <select
            value={activeProjectId ?? ''}
            onChange={(e) => selectProject(e.target.value)}
            className="hud-input"
            style={{ padding: '4px 8px', fontSize: 13 }}
          >
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Link href="/discovery" className="hud-btn" style={{ fontSize: 12 }}>+ novo projeto</Link>
          <Link href="/" className="hud-btn" style={{ fontSize: 12 }}>← painel</Link>
        </div>
      </div>

      {/* Objetivo ativo / refinado */}
      {refinedObjective && (
        <div className="hud-surface" style={{ padding: '8px 12px', fontSize: 13 }}>
          <span style={{ color: 'var(--hud-text-2)', fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5 }}>Objetivo</span>
          <div style={{ marginTop: 2 }}>{refinedObjective}</div>
        </div>
      )}

      {/* Context Badge */}
      <ContextBadge projectId={activeProjectId} query={refinedObjective ?? input} />

      {/* Conversa */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8, overflowY: 'auto', minHeight: 200 }}>
        {feed.length === 0 && (
          <div className="hud-empty" style={{ margin: 'auto', textAlign: 'center', color: 'var(--hud-dim)' }}>
            Fale em português o que você quer fazer.<br />O Rayzen estrutura, comprime o contexto e dispara a missão.
          </div>
        )}
        {feed.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'hud-msg-user' : 'hud-msg-ai'}>
            {m.content}
          </div>
        ))}
        {sending && <div className="hud-msg-ai hud-pulse" style={{ color: 'var(--hud-dim)' }}>pensando…</div>}
        <div ref={feedEndRef} />
      </div>

      {/* Timeline da missão */}
      {mission && (
        <div className="hud-card" style={{ padding: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>{mission.title}</span>
            <button
              className="hud-btn hud-btn-primary"
              style={{ fontSize: 12 }}
              onClick={runWorkflow}
              disabled={runningWorkflow || mission.status === 'active'}
            >
              {runningWorkflow ? 'executando…' : mission.status === 'active' ? 'rodando' : 'executar workflow'}
            </button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {mission.steps.map((s) => (
              <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: STEP_COLOR[s.status], flexShrink: 0 }} />
                <span style={{ color: s.status === 'pending' ? 'var(--hud-text-2)' : 'var(--hud-text)' }}>{s.title}</span>
                <span style={{ marginLeft: 'auto', color: 'var(--hud-dim)', fontSize: 11 }}>{s.executor}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Sessão assistida (Claude Code) — status + aprovação por etapa */}
      {supSession && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {supSession.status === 'waiting' && supSession.pendingQuestion && (
            <ApprovalCard
              question={supSession.pendingQuestion}
              requiresApproval={supSession.pendingRequiresApproval}
              options={supSession.pendingApprovalOptions ?? []}
              busy={replyingApproval}
              onReply={answerApproval}
            />
          )}
          {supSession.status === 'active' && (
            <div className="hud-surface" style={{ padding: '8px 12px' }}>
              <div className="hud-pulse" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--hud-cyan)', marginBottom: 6 }}>
                ⚙ Claude Code executando…
              </div>
              {supSession.liveLog ? (
                <pre style={{
                  margin: 0, padding: '8px 10px', fontSize: 11, lineHeight: 1.5,
                  background: 'var(--hud-bg)', borderRadius: 4, overflowY: 'auto',
                  maxHeight: 240, whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                  color: 'var(--hud-text-2)', fontFamily: 'monospace',
                }}>
                  {supSession.liveLog}
                  <div ref={logEndRef} />
                </pre>
              ) : (
                <div style={{ fontSize: 11, color: 'var(--hud-dim)' }}>aguardando output…</div>
              )}
            </div>
          )}
          {supSession.status === 'completed' && (
            <div className="hud-card" style={{ padding: 12, fontSize: 13, borderColor: '#22c55e' }}>
              <div style={{ color: '#22c55e', fontSize: 11, textTransform: 'uppercase', marginBottom: 4 }}>✓ sessão concluída</div>
              <div style={{ whiteSpace: 'pre-wrap' }}>{supSession.summary}</div>
              {supSession.previewUrl && <a href={supSession.previewUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--hud-cyan)' }}>🔗 preview</a>}
            </div>
          )}
          {supSession.status === 'error' && (
            <div className="hud-card" style={{ padding: 12, fontSize: 13, borderColor: '#ef4444', color: '#ef4444' }}>
              ✗ erro: {supSession.summary}
            </div>
          )}
        </div>
      )}

      {note && <div style={{ color: '#ef4444', fontSize: 12 }}>{note}</div>}
      {voiceError && <div style={{ color: '#ef4444', fontSize: 12 }}>mic: {voiceError}</div>}

      {/* Input */}
      <div className="hud-input-bar" style={{ display: 'flex', gap: 8 }}>
        <button
          className="hud-btn"
          title={voiceState === 'recording' ? 'parar gravação' : 'gravar voz'}
          onClick={() => voiceState === 'recording' ? stopVoice() : void startVoice()}
          disabled={voiceState === 'transcribing' || !activeProjectId}
          style={voiceState === 'recording' ? { color: '#ef4444', boxShadow: '0 0 0 1px #ef4444' } : undefined}
        >
          {voiceState === 'recording' ? '⏹' : voiceState === 'transcribing' ? '…' : '🎙'}
        </button>
        <input
          className="hud-input"
          style={{ flex: 1 }}
          placeholder={activeProjectId ? 'quero…' : 'selecione um projeto'}
          value={input}
          disabled={!activeProjectId}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void sendMessage() } }}
        />
        <button className="hud-btn" onClick={sendMessage} disabled={sending || !input.trim()}>enviar</button>
        <button
          className="hud-btn hud-btn-primary"
          onClick={execute}
          disabled={executing || !sessionId}
          title={readyToExecute ? 'pronto para executar' : 'executa o que foi conversado'}
          style={readyToExecute ? { boxShadow: '0 0 0 1px var(--hud-cyan-40)' } : undefined}
        >
          {executing ? 'estruturando…' : 'executar'}
        </button>
        <button
          className="hud-btn"
          onClick={launchAssisted}
          disabled={launchingAssisted || !activeProjectId || (!!supSession && (supSession.status === 'active' || supSession.status === 'waiting'))}
          title="Executa via Claude Code real, pausando a cada etapa para aprovação"
        >
          {launchingAssisted ? 'iniciando…' : 'assistido'}
        </button>
      </div>
    </div>
  )
}
