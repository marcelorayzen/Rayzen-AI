'use client'

import { useState, useRef, useEffect, useCallback } from 'react'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

function authHeaders(extra?: Record<string, string>): Record<string, string> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('rayzen_token') : null
  return {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(extra ?? {}),
  }
}
import { useRouter } from 'next/navigation'
import ReactMarkdown from 'react-markdown'

const MODULE_LABELS: Record<string, string> = {
  brain:   'memory',
  jarvis:  'execution',
  doc:     'documents',
  content: 'content-engine',
  system:  'system',
}

interface Message {
  role: 'user' | 'assistant'
  content: string
  module?: string
}

interface Session {
  sessionId: string
  messages: number
  lastActivity: string
  title: string
}

interface Project {
  id: string
  name: string
  status: string
}

interface ActivityEvent {
  id: string
  source: string
  type: string
  content: string
  metadata: Record<string, unknown>
  ts: string
  memoryClass?: string
}

interface ProjectDoc {
  id: string
  type: string
  content: string
  generatedAt: string
  reviewedAt: string | null
}

interface SynthesisArtifact {
  id: string
  sessionId: string
  type?: string
  createdAt: string
  content: {
    summary: string
    decisions: string[]
    next_steps: string[]
    learnings: string[]
    confidence?: 'low' | 'medium' | 'high'
  }
}

interface ProjectState {
  objective: string
  stage: string
  blockers: string[]
  recentDecisions: string[]
  nextSteps: string[]
  risks: string[]
  docGaps: string[]
  riskLevel: 'low' | 'medium' | 'high'
  milestones: Array<{ id: string; title: string; status: 'pending' | 'active' | 'done' }>
  backlog: Array<{ id: string; title: string; priority: 'high' | 'medium' | 'low' }>
  activeFocus: string
  definitionOfDone: string
  updatedAt: string
}

interface HealthBreakdown {
  activity: number
  documentation: number
  consistency: number
  nextSteps: number
  blockers: number
  focus: number
}

interface HealthScore {
  id: string
  score: number
  breakdown: HealthBreakdown
  createdAt: string
}

interface HealthData {
  current: HealthScore | null
  history: HealthScore[]
}

interface GitContext {
  branches: Record<string, number>
  recentCommits: Array<{ hash: string; message: string; branch: string; ts: string }>
  mostTouchedFiles: Array<{ file: string; count: number }>
  lastBranch: string | null
  lastCommitHash: string | null
  lastCommitMessage: string | null
  totalGitEvents: number
}

type QuickCaptureIntent = 'decision' | 'idea' | 'problem' | 'reference'
type MemoryClassFilter = 'all' | 'inbox' | 'working' | 'consolidated' | 'archive'
type WorkMode = 'implementation' | 'debugging' | 'architecture' | 'study' | 'review'

interface Recommendation {
  id: string
  type: string
  title: string
  description: string
  priority: 'low' | 'medium' | 'high'
  action: string | null
  computedAt: string
}

interface DocVersion {
  id: string
  content: string
  diff: string | null
  reason: string
  sourceIds: string[]
  createdAt: string
}

type ImportTab = 'github' | 'file' | 'url' | 'notion'

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [sessionId, setSessionId] = useState('')
  const [playingIndex, setPlayingIndex] = useState<number | null>(null)
  const [sessionTokens, setSessionTokens] = useState(0)
  const [dailyTokens, setDailyTokens] = useState<number | null>(null)
  const [recording, setRecording] = useState(false)
  const [transcribing, setTranscribing] = useState(false)
  const [sessions, setSessions] = useState<Session[]>([])
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [loadingSession, setLoadingSession] = useState<string | null>(null)
  const [deletingSession, setDeletingSession] = useState<string | null>(null)
  const router = useRouter()
  const [projects, setProjects] = useState<Project[]>([])
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null)
  const [activityOpen, setActivityOpen] = useState(false)
  const [activityEvents, setActivityEvents] = useState<ActivityEvent[]>([])
  const [activityLoading, setActivityLoading] = useState(false)
  const [memoryClassFilter, setMemoryClassFilter] = useState<MemoryClassFilter>('all')
  const [synthesisOpen, setSynthesisOpen] = useState(false)
  const [synthesisArtifacts, setSynthesisArtifacts] = useState<SynthesisArtifact[]>([])
  const [synthesisLoading, setSynthesisLoading] = useState(false)
  const [synthesizing, setSynthesizing] = useState(false)
  const [docsOpen, setDocsOpen] = useState(false)
  const [projectDocs, setProjectDocs] = useState<ProjectDoc[]>([])
  const [docsLoading, setDocsLoading] = useState(false)
  const [generatingDocs, setGeneratingDocs] = useState(false)
  const [activeDocType, setActiveDocType] = useState<string>('project_state')
  const [syncing, setSyncing] = useState(false)
  const [syncResult, setSyncResult] = useState<{ synced: number; conflicts: Array<{type: string; vaultModifiedAt: string}> } | null>(null)
  const [versionsOpen, setVersionsOpen] = useState(false)
  const [versions, setVersions] = useState<DocVersion[]>([])
  const [versionsLoading, setVersionsLoading] = useState(false)
  const [expandedVersion, setExpandedVersion] = useState<string | null>(null)
  const [projectState, setProjectState] = useState<ProjectState | null>(null)
  const [stateOpen, setStateOpen] = useState(false)
  const [stateRefreshing, setStateRefreshing] = useState(false)
  const [gitContext, setGitContext] = useState<GitContext | null>(null)
  const [gitOpen, setGitOpen] = useState(false)
  const [recommendations, setRecommendations] = useState<Recommendation[]>([])
  const [recsOpen, setRecsOpen] = useState(false)
  const [recsLoading, setRecsLoading] = useState(false)
  const [dismissing, setDismissing] = useState<string | null>(null)
  const [checkpointing, setCheckpointing] = useState(false)
  const [quickCaptureOpen, setQuickCaptureOpen] = useState(false)
  const [quickCaptureIntent, setQuickCaptureIntent] = useState<QuickCaptureIntent>('idea')
  const [quickCaptureText, setQuickCaptureText] = useState('')
  const [quickCaptureSaving, setQuickCaptureSaving] = useState(false)
  const [healthOpen, setHealthOpen] = useState(false)
  const [healthData, setHealthData] = useState<HealthData | null>(null)
  const [workMode, setWorkMode] = useState<WorkMode | null>(null)
  const [newProjectOpen, setNewProjectOpen] = useState(false)
  const [newProjectName, setNewProjectName] = useState('')
  const [newProjectDesc, setNewProjectDesc] = useState('')
  const [creatingProject, setCreatingProject] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [importTab, setImportTab] = useState<ImportTab>('github')
  const [importLoading, setImportLoading] = useState(false)
  const [importResult, setImportResult] = useState<string | null>(null)
  const [githubUser, setGithubUser] = useState('')
  const [githubToken, setGithubToken] = useState('')
  const [importUrl, setImportUrl] = useState('')
  const [notionToken, setNotionToken] = useState('')
  const [notionPageId, setNotionPageId] = useState('')
  const [memoryOpen, setMemoryOpen] = useState(false)
  const [memoryDocs, setMemoryDocs] = useState<Array<{ id: string; sourcePath: string | null; createdAt: string }>>([])
  const [memoryDocsLoading, setMemoryDocsLoading] = useState(false)
  const [memorySearch, setMemorySearch] = useState('')
  const [memorySearchResults, setMemorySearchResults] = useState<Array<{ id: string; content: string; sourcePath: string | null; score: number }> | null>(null)
  const [memorySearching, setMemorySearching] = useState(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const tokenQueueRef = useRef<string[]>([])
  const drainActiveRef = useRef(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const submitMessageRef = useRef<(text: string) => void>(() => {})
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const token = localStorage.getItem('rayzen_token')
    if (!token) {
      router.push('/login')
      return
    }
  }, [router])

  useEffect(() => {
    fetch(`${API_URL}/sessions/tokens`, { headers: authHeaders() })
      .then((r) => r.json())
      .then((d) => setDailyTokens(d.last24h?.tokens ?? 0))
      .catch(() => null)
  }, [])

  useEffect(() => {
    fetch(`${API_URL}/projects`, { headers: authHeaders() })
      .then((r) => r.json())
      .then((d) => setProjects(d as Project[]))
      .catch(() => null)
  }, [])

  useEffect(() => {
    setSessionId(crypto.randomUUID())
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const loadSessions = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/sessions`, { headers: authHeaders() })
      const data = await res.json()
      setSessions(Array.isArray(data) ? data : [])
    } catch {
      // silencioso
    }
  }, [])

  const openSidebar = useCallback(() => {
    setSidebarOpen(true)
    loadSessions()
  }, [loadSessions])

  const loadSession = useCallback(async (sid: string) => {
    if (loadingSession) return
    setLoadingSession(sid)
    try {
      const res = await fetch(`${API_URL}/sessions/${sid}/messages`, { headers: authHeaders() })
      const data = await res.json() as Array<{ role: string; content: string; module: string | null }>
      const loaded: Message[] = data.map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
        module: m.module ?? undefined,
      }))
      setMessages(loaded)
      setSessionId(sid)
      setSessionTokens(0)
      setSidebarOpen(false)
    } catch {
      // silencioso
    } finally {
      setLoadingSession(null)
    }
  }, [loadingSession])

  const deleteSession = useCallback(async (sid: string, e: React.MouseEvent) => {
    e.stopPropagation()
    if (deletingSession) return
    setDeletingSession(sid)
    try {
      await fetch(`${API_URL}/sessions/${sid}`, { method: 'DELETE', headers: authHeaders() })
      setSessions((prev) => prev.filter((s) => s.sessionId !== sid))
      if (sid === sessionId) {
        setMessages([])
        setSessionId(crypto.randomUUID())
        setSessionTokens(0)
      }
    } catch {
      // silencioso
    } finally {
      setDeletingSession(null)
    }
  }, [deletingSession, sessionId])

  const newChat = useCallback(() => {
    setMessages([])
    setSessionId(crypto.randomUUID())
    setSessionTokens(0)
    setSidebarOpen(false)
  }, [])

  const loadActivityEvents = useCallback(async (memClass: MemoryClassFilter) => {
    setActivityLoading(true)
    try {
      const params = new URLSearchParams({ limit: '40' })
      if (activeProjectId) params.set('project_id', activeProjectId)
      if (memClass !== 'all') params.set('memory_class', memClass)
      const res = await fetch(`${API_URL}/events?${params}`, { headers: authHeaders() })
      const data = await res.json() as ActivityEvent[]
      setActivityEvents(data)
    } catch {
      setActivityEvents([])
    } finally {
      setActivityLoading(false)
    }
  }, [activeProjectId])

  const openActivity = useCallback(async () => {
    setActivityOpen(true)
    setMemoryClassFilter('all')
    loadActivityEvents('all')
  }, [loadActivityEvents])

  const openSynthesis = useCallback(async () => {
    setSynthesisOpen(true)
    setSynthesisLoading(true)
    try {
      const qs = activeProjectId ? `?project_id=${activeProjectId}` : ''
      const res = await fetch(`${API_URL}/synthesis/artifacts${qs}`, { headers: authHeaders() })
      setSynthesisArtifacts(await res.json() as SynthesisArtifact[])
    } catch { setSynthesisArtifacts([]) }
    finally { setSynthesisLoading(false) }
  }, [activeProjectId])

  const synthesizeCurrent = useCallback(async () => {
    if (messages.length === 0) {
      alert('Converse primeiro — a sessão ainda não tem mensagens para sintetizar.')
      return
    }
    setSynthesizing(true)
    try {
      const res = await fetch(`${API_URL}/synthesis/session`, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ sessionId, ...(activeProjectId ? { projectId: activeProjectId } : {}), ...(workMode ? { workMode } : {}) }),
      })
      if (!res.ok) {
        const err = await res.json() as { message?: string }
        throw new Error(err.message ?? `HTTP ${res.status}`)
      }
      const artifact = await res.json() as SynthesisArtifact
      setSynthesisArtifacts(prev => [artifact, ...prev])
    } catch (err) {
      alert(`Erro ao sintetizar: ${err instanceof Error ? err.message : 'falhou'}`)
    } finally { setSynthesizing(false) }
  }, [sessionId, activeProjectId, messages])

  const openDocs = useCallback(async () => {
    if (!activeProjectId) return
    setDocsOpen(true)
    setDocsLoading(true)
    try {
      const res = await fetch(`${API_URL}/documentation/${activeProjectId}`, { headers: authHeaders() })
      setProjectDocs(await res.json() as ProjectDoc[])
    } catch { setProjectDocs([]) }
    finally { setDocsLoading(false) }
  }, [activeProjectId])

  const generateAllDocs = useCallback(async () => {
    if (!activeProjectId) return
    setGeneratingDocs(true)
    try {
      await fetch(`${API_URL}/documentation/generate/${activeProjectId}`, {
        method: 'POST',
        headers: authHeaders(),
      })
      const res = await fetch(`${API_URL}/documentation/${activeProjectId}`, { headers: authHeaders() })
      setProjectDocs(await res.json() as ProjectDoc[])
    } catch { /* silencioso */ }
    finally { setGeneratingDocs(false) }
  }, [activeProjectId])

  const syncObsidian = useCallback(async (force = false) => {
    if (!activeProjectId) return
    setSyncing(true)
    setSyncResult(null)
    try {
      const res = await fetch(`${API_URL}/obsidian/sync/${activeProjectId}${force ? '?force=true' : ''}`, {
        method: 'POST',
        headers: authHeaders(),
      })
      const data = await res.json() as { synced: Array<{type:string}>; conflicts: Array<{type:string; vaultModifiedAt:string}>; deepLinks: Record<string,string> }
      setSyncResult({ synced: data.synced?.length ?? 0, conflicts: data.conflicts ?? [] })
    } catch { /* silencioso */ }
    finally { setSyncing(false) }
  }, [activeProjectId])

  const openVersions = useCallback(async (type: string) => {
    if (!activeProjectId) return
    setVersionsOpen(true)
    setVersionsLoading(true)
    setVersions([])
    setExpandedVersion(null)
    try {
      const res = await fetch(`${API_URL}/documentation/${activeProjectId}/${type}/versions`, { headers: authHeaders() })
      if (res.ok) setVersions(await res.json() as DocVersion[])
    } catch { /* silencioso */ }
    finally { setVersionsLoading(false) }
  }, [activeProjectId])

  const deleteProject = useCallback(async (id: string) => {
    if (!confirm('Deletar este projeto? Esta ação não pode ser desfeita.')) return
    await fetch(`${API_URL}/projects/${id}`, { method: 'DELETE', headers: authHeaders() })
    setProjects((prev) => prev.filter((p) => p.id !== id))
    if (activeProjectId === id) setActiveProjectId(null)
  }, [activeProjectId])

  const renameProject = useCallback(async (id: string, currentName: string) => {
    const name = prompt('Novo nome do projeto:', currentName)
    if (!name?.trim() || name.trim() === currentName) return
    const res = await fetch(`${API_URL}/projects/${id}`, {
      method: 'PATCH',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ name: name.trim() }),
    })
    const updated = await res.json() as { id: string; name: string; status: string }
    setProjects((prev) => prev.map((p) => p.id === id ? { ...p, name: updated.name } : p))
  }, [])

  const loadProjectState = useCallback(async (projectId: string) => {
    try {
      const res = await fetch(`${API_URL}/projects/${projectId}/state`, { headers: authHeaders() })
      if (res.ok) setProjectState(await res.json() as ProjectState)
    } catch { /* silencioso */ }
  }, [])

  const loadGitContext = useCallback(async (projectId: string) => {
    try {
      const res = await fetch(`${API_URL}/projects/${projectId}/git`, { headers: authHeaders() })
      if (res.ok) setGitContext(await res.json() as GitContext)
    } catch { /* silencioso */ }
  }, [])

  const loadRecommendations = useCallback(async (projectId: string) => {
    try {
      const res = await fetch(`${API_URL}/projects/${projectId}/recommendations`, { headers: authHeaders() })
      if (res.ok) {
        const data = await res.json() as Recommendation[]
        setRecommendations(data.filter(r => r.type !== 'all_clear'))
      }
    } catch { /* silencioso */ }
  }, [])

  const loadHealth = useCallback(async (projectId: string) => {
    try {
      const res = await fetch(`${API_URL}/projects/${projectId}/health`, { headers: authHeaders() })
      if (res.ok) setHealthData(await res.json() as HealthData)
    } catch { /* silencioso */ }
  }, [])

  const createProject = useCallback(async () => {
    if (!newProjectName.trim()) return
    setCreatingProject(true)
    try {
      const res = await fetch(`${API_URL}/projects`, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ name: newProjectName.trim(), description: newProjectDesc.trim() || undefined }),
      })
      if (res.ok) {
        const project = await res.json() as Project
        setProjects(prev => [...prev, project])
        setActiveProjectId(project.id)
        setNewProjectOpen(false)
        setNewProjectName('')
        setNewProjectDesc('')
      }
    } catch { /* silencioso */ }
    finally { setCreatingProject(false) }
  }, [newProjectName, newProjectDesc])

  useEffect(() => {
    if (activeProjectId) {
      loadProjectState(activeProjectId)
      loadGitContext(activeProjectId)
      loadRecommendations(activeProjectId)
      loadHealth(activeProjectId)
    } else {
      setProjectState(null)
      setGitContext(null)
      setRecommendations([])
      setHealthData(null)
    }
  }, [activeProjectId, loadProjectState, loadGitContext, loadRecommendations, loadHealth])

  const openRecommendations = useCallback(async () => {
    if (!activeProjectId) return
    setRecsOpen(true)
    setRecsLoading(true)
    try {
      const res = await fetch(`${API_URL}/projects/${activeProjectId}/recommendations`, { headers: authHeaders() })
      if (res.ok) {
        const data = await res.json() as Recommendation[]
        setRecommendations(data.filter(r => r.type !== 'all_clear'))
      }
    } catch { /* silencioso */ }
    finally { setRecsLoading(false) }
  }, [activeProjectId])

  const dismissRec = useCallback(async (recId: string) => {
    if (!activeProjectId) return
    setDismissing(recId)
    try {
      await fetch(`${API_URL}/projects/${activeProjectId}/recommendations/${recId}/dismiss`, {
        method: 'POST',
        headers: authHeaders(),
      })
      setRecommendations(prev => prev.filter(r => r.id !== recId))
    } catch { /* silencioso */ }
    finally { setDismissing(null) }
  }, [activeProjectId])

  const refreshProjectState = useCallback(async () => {
    if (!activeProjectId) return
    setStateRefreshing(true)
    try {
      const res = await fetch(`${API_URL}/projects/${activeProjectId}/state/refresh`, {
        method: 'POST',
        headers: authHeaders(),
      })
      if (res.ok) setProjectState(await res.json() as ProjectState)
    } catch { /* silencioso */ }
    finally { setStateRefreshing(false) }
  }, [activeProjectId])

  const doCheckpoint = useCallback(async () => {
    if (!activeProjectId) return
    setCheckpointing(true)
    try {
      const res = await fetch(`${API_URL}/synthesis/checkpoint`, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ projectId: activeProjectId, ...(workMode ? { workMode } : {}) }),
      })
      if (res.ok) {
        const artifact = await res.json() as SynthesisArtifact
        setSynthesisArtifacts(prev => [artifact, ...prev])
        setSynthesisOpen(true)
      }
    } catch { /* silencioso */ }
    finally { setCheckpointing(false) }
  }, [activeProjectId])

  const submitQuickCapture = useCallback(async () => {
    if (!quickCaptureText.trim() || !activeProjectId) return
    setQuickCaptureSaving(true)
    try {
      await fetch(`${API_URL}/events`, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          projectId: activeProjectId,
          source: 'manual',
          type: quickCaptureIntent === 'decision' ? 'decision' : 'note',
          intent: quickCaptureIntent,
          content: quickCaptureText.trim(),
        }),
      })
      setQuickCaptureText('')
      setQuickCaptureOpen(false)
    } catch { /* silencioso */ }
    finally { setQuickCaptureSaving(false) }
  }, [quickCaptureText, quickCaptureIntent, activeProjectId])

  const handleImportGithub = useCallback(async () => {
    if (!githubUser.trim()) return
    setImportLoading(true)
    setImportResult(null)
    try {
      // Remove URL caso o usuário cole o link completo
      const username = githubUser.trim().replace(/^https?:\/\/github\.com\//, '').replace(/\/$/, '')
      const res = await fetch(`${API_URL}/memory/index/github`, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ username, token: githubToken.trim() || undefined, projectId: activeProjectId ?? undefined }),
      })
      if (!res.ok) {
        const err = await res.text()
        throw new Error(err || `HTTP ${res.status}`)
      }
      const data = await res.json() as { indexed: number; repos: number }
      setImportResult(`${data.repos} repositórios indexados (${data.indexed} chunks)`)
    } catch (err) {
      setImportResult(`Erro: ${err instanceof Error ? err.message : 'falhou'}`)
    } finally {
      setImportLoading(false)
    }
  }, [githubUser, githubToken, activeProjectId])

  const handleImportUrl = useCallback(async () => {
    if (!importUrl.trim()) return
    setImportLoading(true)
    setImportResult(null)
    try {
      const res = await fetch(`${API_URL}/memory/index/url`, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ url: importUrl.trim(), projectId: activeProjectId ?? undefined }),
      })
      if (!res.ok) throw new Error(await res.text() || `HTTP ${res.status}`)
      const data = await res.json() as { indexed: number }
      setImportResult(`${data.indexed} chunks indexados`)
    } catch (err) {
      setImportResult(`Erro: ${err instanceof Error ? err.message : 'falhou'}`)
    } finally {
      setImportLoading(false)
    }
  }, [importUrl, activeProjectId])

  const handleImportFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    if (files.length === 0) return
    setImportLoading(true)
    setImportResult(null)
    try {
      let totalChunks = 0
      let errors = 0
      for (const file of files) {
        try {
          const formData = new FormData()
          formData.append('file', file)
          if (activeProjectId) formData.append('projectId', activeProjectId)
          const res = await fetch(`${API_URL}/memory/index/file`, {
            method: 'POST',
            headers: authHeaders(),
            body: formData,
          })
          if (!res.ok) throw new Error(await res.text() || `HTTP ${res.status}`)
          const data = await res.json() as { indexed: number }
          totalChunks += data.indexed
        } catch {
          errors++
        }
        setImportResult(`Indexando… ${files.indexOf(file) + 1}/${files.length}`)
      }
      const msg = errors > 0
        ? `${files.length - errors}/${files.length} arquivos indexados (${totalChunks} chunks) — ${errors} erro(s)`
        : `${files.length} arquivo${files.length > 1 ? 's' : ''} indexado${files.length > 1 ? 's' : ''} (${totalChunks} chunks)`
      setImportResult(msg)
    } catch (err) {
      setImportResult(`Erro: ${err instanceof Error ? err.message : 'falhou'}`)
    } finally {
      setImportLoading(false)
      e.target.value = ''
    }
  }, [])

  const handleImportNotion = useCallback(async () => {
    if (!notionToken.trim()) return
    setImportLoading(true)
    setImportResult(null)
    try {
      const res = await fetch(`${API_URL}/memory/index/notion`, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ integrationToken: notionToken.trim(), rootPageId: notionPageId.trim() || undefined, projectId: activeProjectId ?? undefined }),
      })
      if (!res.ok) {
        const err = await res.json() as { message?: string }
        throw new Error(err.message ?? `HTTP ${res.status}`)
      }
      const data = await res.json() as { indexed: number; pages: number }
      setImportResult(`${data.pages} páginas indexadas (${data.indexed} chunks)`)
    } catch (err) {
      setImportResult(`Erro: ${err instanceof Error ? err.message : 'falhou'}`)
    } finally {
      setImportLoading(false)
    }
  }, [notionToken, notionPageId, activeProjectId])

  const openMemoryPanel = useCallback(async () => {
    setMemoryOpen(true)
    setMemorySearch('')
    setMemorySearchResults(null)
    setMemoryDocsLoading(true)
    try {
      const qs = activeProjectId ? `?projectId=${activeProjectId}` : ''
      const res = await fetch(`${API_URL}/memory/documents${qs}`, { headers: authHeaders() })
      const data = await res.json() as Array<{ id: string; sourcePath: string | null; createdAt: string }>
      setMemoryDocs(data)
    } catch { /* silencioso */ }
    finally { setMemoryDocsLoading(false) }
  }, [])

  const handleMemorySearch = useCallback(async () => {
    if (!memorySearch.trim()) { setMemorySearchResults(null); return }
    setMemorySearching(true)
    try {
      const res = await fetch(`${API_URL}/memory/search`, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ query: memorySearch.trim(), sessionId: 'memory-panel' }),
      })
      const data = await res.json() as { sources?: Array<{ id: string; content: string; sourcePath: string | null; score: number }> }
      setMemorySearchResults(data.sources ?? [])
    } catch { setMemorySearchResults([]) }
    finally { setMemorySearching(false) }
  }, [memorySearch])

  const drainQueue = useCallback(() => {
    if (drainActiveRef.current) return
    drainActiveRef.current = true

    const tick = () => {
      const token = tokenQueueRef.current.shift()
      if (token === undefined) {
        drainActiveRef.current = false
        return
      }
      setMessages((prev) => {
        const updated = [...prev]
        const last = updated[updated.length - 1]
        updated[updated.length - 1] = { ...last, content: last.content + token }
        return updated
      })
      setTimeout(tick, 18)
    }
    tick()
  }, [])

  const toggleRecording = useCallback(async () => {
    if (recording) {
      mediaRecorderRef.current?.stop()
      return
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4'
      const mediaRecorder = new MediaRecorder(stream, { mimeType })
      mediaRecorderRef.current = mediaRecorder
      chunksRef.current = []

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }

      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop())
        setRecording(false)
        setTranscribing(true)

        const blob = new Blob(chunksRef.current, { type: mimeType })
        const formData = new FormData()
        formData.append('file', blob, `audio.${mimeType.includes('webm') ? 'webm' : 'mp4'}`)

        try {
          const res = await fetch(`${API_URL}/voice/transcribe`, {
            method: 'POST',
            headers: authHeaders(),
            body: formData,
          })
          if (!res.ok) throw new Error('STT falhou')
          const data = await res.json() as { text: string }
          if (data.text) submitMessageRef.current(data.text)
        } catch (err) {
          console.error('STT error:', err)
        } finally {
          setTranscribing(false)
        }
      }

      mediaRecorder.start()
      setRecording(true)
    } catch (err) {
      console.error('Microfone error:', err)
    }
  }, [recording])

  const playAudio = useCallback(async (text: string, index: number) => {
    if (playingIndex === index) {
      audioRef.current?.pause()
      setPlayingIndex(null)
      return
    }

    setPlayingIndex(index)
    try {
      const res = await fetch(`${API_URL}/voice/synthesize`, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ text }),
      })
      if (!res.ok) throw new Error('TTS falhou')

      const blob = await res.blob()
      const url = URL.createObjectURL(blob)

      if (audioRef.current) {
        audioRef.current.pause()
        URL.revokeObjectURL(audioRef.current.src)
      }

      const audio = new Audio(url)
      audioRef.current = audio
      audio.onended = () => setPlayingIndex(null)
      audio.onerror = () => setPlayingIndex(null)
      await audio.play()
    } catch {
      setPlayingIndex(null)
    }
  }, [playingIndex])

  const sendMessage = useCallback(async (userMessage: string) => {
    if (!userMessage.trim() || loading) return
    setInput('')
    setMessages((prev) => [...prev, { role: 'user', content: userMessage }])
    setLoading(true)

    try {
      const res = await fetch(`${API_URL}/orchestrate/stream`, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ prompt: userMessage, sessionId, ...(activeProjectId ? { projectId: activeProjectId } : {}), ...(workMode ? { workMode } : {}) }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)

      const reader = res.body?.getReader()
      const decoder = new TextDecoder()
      let currentModule = ''
      let buffer = ''

      setMessages((prev) => [...prev, { role: 'assistant', content: '', module: '' }])

      while (reader) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (line.startsWith('event: ')) continue
          if (!line.startsWith('data: ')) continue

          let data: Record<string, unknown>
          try {
            data = JSON.parse(line.slice(6)) as Record<string, unknown>
          } catch {
            continue
          }

          if (typeof data.module === 'string') currentModule = data.module

          if (data.text !== undefined) {
            if (currentModule) {
              setMessages((prev) => {
                const updated = [...prev]
                updated[updated.length - 1] = { ...updated[updated.length - 1], module: currentModule }
                return updated
              })
            }
            tokenQueueRef.current.push(data.text as string)
            drainQueue()
          }

          if (typeof data.tokensUsed === 'number' && data.tokensUsed > 0) {
            setSessionTokens((prev) => prev + (data.tokensUsed as number))
            setDailyTokens((prev) => (prev ?? 0) + (data.tokensUsed as number))
          }
        }
      }
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: `Erro: ${err instanceof Error ? err.message : 'desconhecido'}` },
      ])
    } finally {
      setLoading(false)
    }
  }, [loading, sessionId, drainQueue])

  useEffect(() => {
    submitMessageRef.current = sendMessage
  }, [sendMessage])

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    sendMessage(input.trim())
    setTimeout(() => inputRef.current?.focus(), 0)
  }

  function formatRelativeTime(dateStr: string) {
    const diff = Date.now() - new Date(dateStr).getTime()
    const mins = Math.floor(diff / 60000)
    if (mins < 1) return 'agora'
    if (mins < 60) return `${mins}min`
    const hours = Math.floor(mins / 60)
    if (hours < 24) return `${hours}h`
    const days = Math.floor(hours / 24)
    return `${days}d`
  }

  const RISK_COLORS: Record<string, string> = {
    low: 'bg-emerald-500',
    medium: 'bg-amber-500',
    high: 'bg-red-500',
  }

  const STAGE_LABELS: Record<string, string> = {
    discovery: 'Descoberta', building: 'Em construção', stabilizing: 'Estabilizando',
    maintaining: 'Manutenção', paused: 'Pausado',
  }

  const INTENT_CONFIG: Record<QuickCaptureIntent, { label: string; color: string }> = {
    decision: { label: 'Decisão', color: 'bg-indigo-600 text-white' },
    idea:     { label: 'Ideia',   color: 'bg-emerald-600 text-white' },
    problem:  { label: 'Problema', color: 'bg-red-600 text-white' },
    reference: { label: 'Referência', color: 'bg-zinc-600 text-white' },
  }

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col">

      {/* Document versions modal */}
      {versionsOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center">
          <div className="fixed inset-0 bg-black/80" onClick={() => setVersionsOpen(false)} />
          <div className="relative z-[60] w-full max-w-2xl bg-zinc-900 border border-zinc-800 rounded-2xl mx-4 max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
              <h2 className="text-sm font-semibold">Histórico de versões</h2>
              <button onClick={() => setVersionsOpen(false)} className="text-zinc-500 hover:text-zinc-300 text-xs">fechar</button>
            </div>
            <div className="overflow-y-auto flex-1 px-6 py-4 space-y-3">
              {versionsLoading && <p className="text-zinc-500 text-xs text-center py-8">Carregando…</p>}
              {!versionsLoading && versions.length === 0 && (
                <p className="text-zinc-500 text-xs text-center py-8">Nenhuma versão anterior. O histórico começa na próxima regeneração.</p>
              )}
              {versions.map((v) => (
                <div key={v.id} className="border border-zinc-800 rounded-xl overflow-hidden">
                  <button
                    onClick={() => setExpandedVersion(expandedVersion === v.id ? null : v.id)}
                    className="w-full flex items-center justify-between px-4 py-3 hover:bg-zinc-800 transition-colors text-left"
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-zinc-300">{new Date(v.createdAt).toLocaleString('pt-BR')}</span>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                        v.reason === 'force_regenerated' ? 'bg-red-900 text-red-300' : 'bg-zinc-700 text-zinc-400'
                      }`}>{v.reason}</span>
                      <span className="text-[10px] text-zinc-600">{v.sourceIds?.length ?? 0} fontes</span>
                    </div>
                    <span className="text-zinc-600 text-xs">{expandedVersion === v.id ? '▲' : '▼'}</span>
                  </button>
                  {expandedVersion === v.id && (
                    <div className="border-t border-zinc-800">
                      {v.diff && (
                        <div className="px-4 py-3 border-b border-zinc-800">
                          <p className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wide mb-2">Diff em relação à versão seguinte</p>
                          <pre className="text-[11px] font-mono whitespace-pre-wrap leading-relaxed">
                            {v.diff.split('\n').map((line, i) => (
                              <span key={i} className={`block ${line.startsWith('+') ? 'text-emerald-400' : line.startsWith('-') ? 'text-red-400' : 'text-zinc-500'}`}>
                                {line}
                              </span>
                            ))}
                          </pre>
                        </div>
                      )}
                      <div className="px-4 py-3 max-h-64 overflow-y-auto">
                        <p className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wide mb-2">Conteúdo desta versão</p>
                        <pre className="text-[11px] text-zinc-400 whitespace-pre-wrap font-mono leading-relaxed">{v.content}</pre>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* New project modal */}
      {newProjectOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="fixed inset-0 bg-black/70" onClick={() => { setNewProjectOpen(false); setNewProjectName(''); setNewProjectDesc('') }} />
          <div className="relative z-50 w-full max-w-sm bg-zinc-900 border border-zinc-800 rounded-2xl p-5 mx-4">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold">Novo projeto</h2>
              <button onClick={() => { setNewProjectOpen(false); setNewProjectName(''); setNewProjectDesc('') }} className="text-zinc-500 hover:text-zinc-300 text-xl leading-none">×</button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-zinc-500 mb-1 block">Nome *</label>
                <input
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') createProject() }}
                  placeholder="ex: rayzen-ai-teste"
                  autoFocus
                  className="w-full bg-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 outline-none focus:ring-1 focus:ring-zinc-600"
                />
              </div>
              <div>
                <label className="text-xs text-zinc-500 mb-1 block">Descrição (opcional)</label>
                <input
                  value={newProjectDesc}
                  onChange={(e) => setNewProjectDesc(e.target.value)}
                  placeholder="ex: plataforma de testes de IA"
                  className="w-full bg-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 outline-none focus:ring-1 focus:ring-zinc-600"
                />
              </div>
              <button
                onClick={createProject}
                disabled={creatingProject || !newProjectName.trim()}
                className="w-full bg-zinc-100 text-zinc-900 rounded-lg py-2 text-sm font-medium disabled:opacity-40 hover:bg-white transition-colors"
              >
                {creatingProject ? 'Criando…' : 'Criar projeto'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Health score modal */}
      {healthOpen && healthData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="fixed inset-0 bg-black/70" onClick={() => setHealthOpen(false)} />
          <div className="relative z-50 w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-2xl mx-4 max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
              <div className="flex items-center gap-3">
                <span className={`text-2xl font-bold font-mono ${
                  (healthData.current?.score ?? 0) >= 70 ? 'text-emerald-400' :
                  (healthData.current?.score ?? 0) >= 40 ? 'text-amber-400' : 'text-red-400'
                }`}>⬡ {healthData.current?.score ?? '—'}</span>
                <div>
                  <p className="text-sm font-semibold">Health score</p>
                  {healthData.current && (
                    <p className="text-[10px] text-zinc-500">{new Date(healthData.current.createdAt).toLocaleString('pt-BR')}</p>
                  )}
                </div>
              </div>
              <button onClick={() => setHealthOpen(false)} className="text-zinc-500 hover:text-zinc-300 text-xs">fechar</button>
            </div>
            <div className="overflow-y-auto flex-1 px-6 py-4 space-y-5">
              {healthData.current && (
                <div className="space-y-2">
                  <p className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wide">Breakdown</p>
                  {([
                    ['Atividade recente', 'activity', 20],
                    ['Documentação em dia', 'documentation', 20],
                    ['Consistência', 'consistency', 20],
                    ['Next steps claros', 'nextSteps', 15],
                    ['Blockers resolvendo', 'blockers', 15],
                    ['Foco definido', 'focus', 10],
                  ] as Array<[string, keyof HealthBreakdown, number]>).map(([label, key, weight]) => {
                    const val = healthData.current!.breakdown[key]
                    return (
                      <div key={key}>
                        <div className="flex items-center justify-between mb-0.5">
                          <span className="text-xs text-zinc-400">{label}</span>
                          <span className="text-xs font-mono text-zinc-300">{val} <span className="text-zinc-600">/ 100 · {weight}%</span></span>
                        </div>
                        <div className="w-full h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${
                              val >= 70 ? 'bg-emerald-500' : val >= 40 ? 'bg-amber-500' : 'bg-red-500'
                            }`}
                            style={{ width: `${val}%` }}
                          />
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
              {healthData.history.length > 1 && (
                <div>
                  <p className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wide mb-2">Histórico 30 dias</p>
                  <div className="flex items-end gap-0.5 h-12">
                    {healthData.history.map((h) => (
                      <div
                        key={h.id}
                        className={`flex-1 rounded-sm min-w-[4px] transition-all ${
                          h.score >= 70 ? 'bg-emerald-600' : h.score >= 40 ? 'bg-amber-600' : 'bg-red-700'
                        }`}
                        style={{ height: `${Math.max(4, h.score)}%` }}
                        title={`${new Date(h.createdAt).toLocaleDateString('pt-BR')}: ${h.score}`}
                      />
                    ))}
                  </div>
                  <div className="flex justify-between mt-1">
                    <span className="text-[9px] text-zinc-700">{new Date(healthData.history[0].createdAt).toLocaleDateString('pt-BR')}</span>
                    <span className="text-[9px] text-zinc-700">{new Date(healthData.history[healthData.history.length - 1].createdAt).toLocaleDateString('pt-BR')}</span>
                  </div>
                </div>
              )}
              {!healthData.current && (
                <p className="text-zinc-500 text-xs text-center py-6">Nenhum score calculado. Faça um refresh do estado do projeto para calcular.</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Recommendations modal */}
      {recsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="fixed inset-0 bg-black/70" onClick={() => setRecsOpen(false)} />
          <div className="relative z-50 w-full max-w-lg bg-zinc-900 border border-zinc-800 rounded-2xl mx-4 max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
              <h2 className="text-sm font-semibold">Recomendações</h2>
              <button onClick={() => setRecsOpen(false)} className="text-zinc-500 hover:text-zinc-300 text-xs">fechar</button>
            </div>
            <div className="overflow-y-auto flex-1 px-6 py-4 space-y-3">
              {recsLoading && <p className="text-zinc-500 text-xs text-center py-8">Analisando projeto…</p>}
              {!recsLoading && recommendations.length === 0 && (
                <div className="text-center py-8">
                  <p className="text-emerald-400 text-sm font-medium">Tudo em ordem</p>
                  <p className="text-zinc-500 text-xs mt-1">Nenhuma inconsistência ou ação urgente identificada.</p>
                </div>
              )}
              {recommendations.map((rec) => (
                <div key={rec.id} className={`border rounded-xl p-4 space-y-2 ${
                  rec.priority === 'high'   ? 'border-red-800 bg-red-950/30' :
                  rec.priority === 'medium' ? 'border-amber-800 bg-amber-950/20' :
                                              'border-zinc-800 bg-zinc-900'
                }`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-semibold uppercase ${
                        rec.priority === 'high'   ? 'bg-red-900 text-red-300' :
                        rec.priority === 'medium' ? 'bg-amber-900 text-amber-300' :
                                                    'bg-zinc-700 text-zinc-400'
                      }`}>{rec.priority}</span>
                      <span className="text-[10px] text-zinc-600 font-mono">{rec.type}</span>
                    </div>
                    <button
                      onClick={() => dismissRec(rec.id)}
                      disabled={dismissing === rec.id}
                      className="text-zinc-600 hover:text-zinc-400 text-xs transition-colors disabled:opacity-40 shrink-0"
                      title="Descartar"
                    >
                      {dismissing === rec.id ? '…' : '×'}
                    </button>
                  </div>
                  <p className="text-xs font-medium text-zinc-200">{rec.title}</p>
                  <p className="text-xs text-zinc-400">{rec.description}</p>
                  {rec.action && (
                    <p className="text-[10px] text-zinc-500 border-t border-zinc-800 pt-2 mt-1">
                      → {rec.action}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Git context modal */}
      {gitOpen && gitContext && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="fixed inset-0 bg-black/70" onClick={() => setGitOpen(false)} />
          <div className="relative z-50 w-full max-w-lg bg-zinc-900 border border-zinc-800 rounded-2xl mx-4 max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold">Git context</span>
                {gitContext.lastBranch && (
                  <span className="text-[10px] bg-zinc-700 text-zinc-300 px-2 py-0.5 rounded font-mono">{gitContext.lastBranch}</span>
                )}
              </div>
              <button onClick={() => setGitOpen(false)} className="text-zinc-500 hover:text-zinc-300 text-xs">fechar</button>
            </div>
            <div className="overflow-y-auto flex-1 px-6 py-4 space-y-5">
              {gitContext.lastCommitHash && (
                <div>
                  <p className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wide mb-1">Último commit</p>
                  <p className="text-xs font-mono text-zinc-300">
                    <span className="text-indigo-400">{gitContext.lastCommitHash}</span>
                    {' '}{gitContext.lastCommitMessage}
                  </p>
                </div>
              )}
              {Object.keys(gitContext.branches).length > 0 && (
                <div>
                  <p className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wide mb-2">Branches ativas</p>
                  <div className="space-y-1">
                    {Object.entries(gitContext.branches)
                      .sort((a, b) => b[1] - a[1])
                      .map(([branch, count]) => (
                        <div key={branch} className="flex items-center justify-between">
                          <span className="text-xs font-mono text-zinc-300">{branch}</span>
                          <span className="text-[10px] text-zinc-600">{count} eventos</span>
                        </div>
                      ))}
                  </div>
                </div>
              )}
              {gitContext.recentCommits.length > 0 && (
                <div>
                  <p className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wide mb-2">Commits recentes</p>
                  <div className="space-y-2">
                    {gitContext.recentCommits.map((c, i) => (
                      <div key={i} className="flex gap-2">
                        <span className="text-[10px] font-mono text-indigo-400 shrink-0 pt-0.5">{c.hash}</span>
                        <div className="min-w-0">
                          <p className="text-xs text-zinc-300 truncate">{c.message}</p>
                          <p className="text-[10px] text-zinc-600">{c.branch} · {new Date(c.ts).toLocaleString('pt-BR')}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {gitContext.mostTouchedFiles.length > 0 && (
                <div>
                  <p className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wide mb-2">Arquivos mais alterados</p>
                  <div className="space-y-1">
                    {gitContext.mostTouchedFiles.map(({ file, count }) => (
                      <div key={file} className="flex items-center justify-between">
                        <span className="text-[11px] font-mono text-zinc-400 truncate max-w-[80%]">{file}</span>
                        <span className="text-[10px] text-zinc-600 shrink-0 ml-2">{count}×</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <p className="text-[10px] text-zinc-700">{gitContext.totalGitEvents} eventos com contexto git</p>
            </div>
          </div>
        </div>
      )}

      {/* Project State modal */}
      {stateOpen && projectState && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="fixed inset-0 bg-black/70" onClick={() => setStateOpen(false)} />
          <div className="relative z-50 w-full max-w-lg bg-zinc-900 border border-zinc-800 rounded-2xl mx-4 max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
              <div className="flex items-center gap-2">
                <div className={`w-2.5 h-2.5 rounded-full ${RISK_COLORS[projectState.riskLevel]}`} />
                <h2 className="text-sm font-semibold">Estado do projeto</h2>
                <span className="text-xs text-zinc-500">{STAGE_LABELS[projectState.stage] ?? projectState.stage}</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={refreshProjectState}
                  disabled={stateRefreshing}
                  className="text-xs bg-zinc-700 hover:bg-zinc-600 disabled:opacity-40 text-zinc-200 px-3 py-1.5 rounded-lg transition-colors"
                >
                  {stateRefreshing ? 'Atualizando…' : 'Atualizar'}
                </button>
                <button onClick={() => setStateOpen(false)} className="text-zinc-500 hover:text-zinc-300 text-xs">fechar</button>
              </div>
            </div>
            <div className="overflow-y-auto flex-1 px-6 py-4 space-y-4">
              {projectState.objective && (
                <div>
                  <p className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wide mb-1">Objetivo atual</p>
                  <p className="text-sm text-zinc-200">{projectState.objective}</p>
                </div>
              )}
              {projectState.blockers.length > 0 && (
                <div>
                  <p className="text-[10px] font-semibold text-red-400 uppercase tracking-wide mb-1">Bloqueios</p>
                  <ul className="space-y-1">{projectState.blockers.map((b, i) => (
                    <li key={i} className="text-xs text-zinc-300 flex gap-1"><span className="text-red-500">■</span>{b}</li>
                  ))}</ul>
                </div>
              )}
              {projectState.nextSteps.length > 0 && (
                <div>
                  <p className="text-[10px] font-semibold text-amber-400 uppercase tracking-wide mb-1">Próximos passos</p>
                  <ul className="space-y-1">{projectState.nextSteps.map((s, i) => (
                    <li key={i} className="text-xs text-zinc-300 flex gap-1"><span className="text-amber-500">→</span>{s}</li>
                  ))}</ul>
                </div>
              )}
              {projectState.recentDecisions.length > 0 && (
                <div>
                  <p className="text-[10px] font-semibold text-indigo-400 uppercase tracking-wide mb-1">Decisões recentes</p>
                  <ul className="space-y-1">{projectState.recentDecisions.map((d, i) => (
                    <li key={i} className="text-xs text-zinc-300">· {d}</li>
                  ))}</ul>
                </div>
              )}
              {projectState.risks.length > 0 && (
                <div>
                  <p className="text-[10px] font-semibold text-orange-400 uppercase tracking-wide mb-1">Riscos</p>
                  <ul className="space-y-1">{projectState.risks.map((r, i) => (
                    <li key={i} className="text-xs text-zinc-400">· {r}</li>
                  ))}</ul>
                </div>
              )}
              {projectState.docGaps.length > 0 && (
                <div>
                  <p className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wide mb-1">Lacunas de documentação</p>
                  <ul className="space-y-1">{projectState.docGaps.map((g, i) => (
                    <li key={i} className="text-xs text-zinc-500">· {g}</li>
                  ))}</ul>
                </div>
              )}
              {projectState.activeFocus && (
                <div className="border border-indigo-800 bg-indigo-950/30 rounded-xl p-3">
                  <p className="text-[10px] font-semibold text-indigo-400 uppercase tracking-wide mb-1">Foco ativo</p>
                  <p className="text-xs text-zinc-200">{projectState.activeFocus}</p>
                  {projectState.definitionOfDone && (
                    <p className="text-[10px] text-zinc-500 mt-1">Done: {projectState.definitionOfDone}</p>
                  )}
                </div>
              )}
              {projectState.milestones && projectState.milestones.length > 0 && (
                <div>
                  <p className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wide mb-1">Milestones</p>
                  <ul className="space-y-1">
                    {projectState.milestones.map((m) => (
                      <li key={m.id} className="flex items-center gap-2 text-xs">
                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                          m.status === 'done' ? 'bg-emerald-500' :
                          m.status === 'active' ? 'bg-amber-400' : 'bg-zinc-600'
                        }`} />
                        <span className={m.status === 'done' ? 'text-zinc-600 line-through' : 'text-zinc-300'}>{m.title}</span>
                        <span className="text-[9px] text-zinc-600 ml-auto">{m.status}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {projectState.backlog && projectState.backlog.length > 0 && (
                <div>
                  <p className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wide mb-1">Backlog</p>
                  <ul className="space-y-1">
                    {projectState.backlog.slice(0, 5).map((b) => (
                      <li key={b.id} className="flex items-center gap-2 text-xs">
                        <span className={`text-[9px] px-1.5 py-0.5 rounded font-medium ${
                          b.priority === 'high' ? 'bg-red-900 text-red-300' :
                          b.priority === 'medium' ? 'bg-amber-900 text-amber-300' : 'bg-zinc-700 text-zinc-500'
                        }`}>{b.priority}</span>
                        <span className="text-zinc-400 truncate">{b.title}</span>
                      </li>
                    ))}
                    {projectState.backlog.length > 5 && (
                      <li className="text-[10px] text-zinc-600">+{projectState.backlog.length - 5} itens</li>
                    )}
                  </ul>
                </div>
              )}
              <p className="text-[10px] text-zinc-700">Atualizado em {new Date(projectState.updatedAt).toLocaleString('pt-BR')}</p>
            </div>
          </div>
        </div>
      )}

      {/* Quick capture modal */}
      {quickCaptureOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="fixed inset-0 bg-black/70" onClick={() => { setQuickCaptureOpen(false); setQuickCaptureText('') }} />
          <div className="relative z-50 w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-2xl p-5 mx-4">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold">Captura rápida</h2>
              <button onClick={() => { setQuickCaptureOpen(false); setQuickCaptureText('') }} className="text-zinc-500 hover:text-zinc-300 text-xl leading-none">×</button>
            </div>
            <div className="flex gap-1.5 mb-4">
              {(Object.keys(INTENT_CONFIG) as QuickCaptureIntent[]).map(intent => (
                <button
                  key={intent}
                  onClick={() => setQuickCaptureIntent(intent)}
                  className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    quickCaptureIntent === intent ? INTENT_CONFIG[intent].color : 'bg-zinc-800 text-zinc-500 hover:text-zinc-300'
                  }`}
                >
                  {INTENT_CONFIG[intent].label}
                </button>
              ))}
            </div>
            <textarea
              value={quickCaptureText}
              onChange={(e) => setQuickCaptureText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submitQuickCapture() }}
              placeholder={
                quickCaptureIntent === 'decision' ? 'O que foi decidido?' :
                quickCaptureIntent === 'idea' ? 'Qual é a ideia?' :
                quickCaptureIntent === 'problem' ? 'Qual é o problema encontrado?' :
                'URL ou referência a guardar'
              }
              rows={4}
              autoFocus
              className="w-full bg-zinc-800 rounded-xl px-4 py-3 text-sm text-zinc-100 placeholder:text-zinc-600 outline-none focus:ring-1 focus:ring-zinc-600 resize-none mb-3"
            />
            <button
              onClick={submitQuickCapture}
              disabled={quickCaptureSaving || !quickCaptureText.trim()}
              className="w-full bg-zinc-100 text-zinc-900 rounded-lg py-2 text-sm font-medium disabled:opacity-40 hover:bg-white transition-colors"
            >
              {quickCaptureSaving ? 'Salvando…' : 'Registrar (⌘ + Enter)'}
            </button>
          </div>
        </div>
      )}

      {/* Activity modal */}
      {activityOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="fixed inset-0 bg-black/70" onClick={() => setActivityOpen(false)} />
          <div className="relative z-50 w-full max-w-lg bg-zinc-900 border border-zinc-800 rounded-2xl p-6 mx-4 max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold">
                Atividade{activeProjectId && projects.find(p => p.id === activeProjectId) ? ` — ${projects.find(p => p.id === activeProjectId)!.name}` : ''}
              </h2>
              <button onClick={() => setActivityOpen(false)} className="text-zinc-500 hover:text-zinc-300 text-xs">fechar</button>
            </div>
            {activeProjectId && (
              <div className="flex gap-1 mb-3 flex-wrap">
                {(['all', 'consolidated', 'working', 'inbox', 'archive'] as MemoryClassFilter[]).map((cls) => (
                  <button
                    key={cls}
                    onClick={() => { setMemoryClassFilter(cls); loadActivityEvents(cls) }}
                    className={`text-[10px] px-2 py-1 rounded-lg font-medium transition-colors ${
                      memoryClassFilter === cls
                        ? cls === 'consolidated' ? 'bg-emerald-700 text-white'
                          : cls === 'working'      ? 'bg-amber-700 text-white'
                          : cls === 'archive'      ? 'bg-zinc-600 text-zinc-300'
                          : cls === 'inbox'        ? 'bg-indigo-700 text-white'
                          : 'bg-zinc-700 text-zinc-200'
                        : 'bg-zinc-800 text-zinc-500 hover:text-zinc-300'
                    }`}
                  >
                    {cls}
                  </button>
                ))}
              </div>
            )}
            <div className="overflow-y-auto flex-1 space-y-2">
              {activityLoading && <p className="text-zinc-500 text-xs text-center py-4">Carregando…</p>}
              {!activityLoading && activityEvents.length === 0 && (
                <p className="text-zinc-500 text-xs text-center py-4">Nenhum evento registrado ainda.</p>
              )}
              {activityEvents.map((ev) => {
                const git = (ev.metadata as Record<string, unknown>)?.['git'] as Record<string, unknown> | null
                return (
                  <div key={ev.id} className="flex gap-3 py-2 border-b border-zinc-800 last:border-0">
                    <div className="flex flex-col items-center gap-1 min-w-[56px]">
                      <span className="text-[10px] text-zinc-500 font-mono">{ev.source}</span>
                      <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium ${
                        ev.type === 'message'   ? 'bg-indigo-900 text-indigo-300' :
                        ev.type === 'index'     ? 'bg-emerald-900 text-emerald-300' :
                        ev.type === 'execution' ? 'bg-amber-900 text-amber-300' :
                        ev.type === 'decision'  ? 'bg-purple-900 text-purple-300' :
                        'bg-zinc-800 text-zinc-400'
                      }`}>{ev.type}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-zinc-300 truncate">{ev.content}</p>
                      <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                        <span className="text-[10px] text-zinc-600">{new Date(ev.ts).toLocaleString('pt-BR')}</span>
                        {ev.memoryClass && ev.memoryClass !== 'inbox' && (
                          <span className={`text-[9px] px-1.5 py-0.5 rounded font-medium ${
                            ev.memoryClass === 'consolidated' ? 'bg-emerald-900 text-emerald-300' :
                            ev.memoryClass === 'working'      ? 'bg-amber-900 text-amber-300' :
                            ev.memoryClass === 'archive'      ? 'bg-zinc-700 text-zinc-500' :
                            'bg-zinc-800 text-zinc-500'
                          }`}>{ev.memoryClass}</span>
                        )}
                        {typeof git?.['branch'] === 'string' && (
                          <span className="text-[10px] font-mono text-indigo-400">⎇ {git['branch']}</span>
                        )}
                        {typeof git?.['commitHash'] === 'string' && (
                          <span className="text-[10px] font-mono text-zinc-600">{git['commitHash']}</span>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* Documentation modal */}
      {docsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="fixed inset-0 bg-black/70" onClick={() => setDocsOpen(false)} />
          <div className="relative z-50 w-full max-w-3xl bg-zinc-900 border border-zinc-800 rounded-2xl mx-4 max-h-[90vh] flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
              <h2 className="text-sm font-semibold">Documentação viva</h2>
              <div className="flex items-center gap-2">
                <button
                  onClick={generateAllDocs}
                  disabled={generatingDocs}
                  className="text-xs bg-zinc-700 hover:bg-zinc-600 disabled:opacity-40 text-zinc-200 px-3 py-1.5 rounded-lg transition-colors"
                >
                  {generatingDocs ? 'Gerando…' : 'Regenerar'}
                </button>
                <button
                  onClick={() => syncObsidian(false)}
                  disabled={syncing}
                  className="text-xs bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white px-3 py-1.5 rounded-lg transition-colors"
                >
                  {syncing ? 'Sincronizando…' : '⬡ Obsidian'}
                </button>
                <button onClick={() => { setDocsOpen(false); setSyncResult(null) }} className="text-zinc-500 hover:text-zinc-300 text-xs">fechar</button>
              </div>
            </div>
            {/* Sync result / conflicts */}
            {syncResult && (
              <div className={`px-6 py-3 text-xs border-b border-zinc-800 ${syncResult.conflicts.length > 0 ? 'bg-amber-950/40' : 'bg-emerald-950/40'}`}>
                {syncResult.conflicts.length === 0 ? (
                  <span className="text-emerald-400">{syncResult.synced} arquivo(s) sincronizado(s) com sucesso.</span>
                ) : (
                  <div className="space-y-1">
                    <p className="text-amber-400 font-medium">{syncResult.conflicts.length} conflito(s) detectado(s) — vault foi editado após a última geração:</p>
                    {syncResult.conflicts.map(c => (
                      <div key={c.type} className="flex items-center justify-between">
                        <span className="text-zinc-400">{c.type} · editado em {new Date(c.vaultModifiedAt).toLocaleString('pt-BR')}</span>
                        <button
                          onClick={() => syncObsidian(true)}
                          className="text-amber-400 hover:text-amber-300 underline ml-2"
                        >
                          sobrescrever
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            {/* Tabs */}
            {(() => {
              const DOC_TABS = [
                { type: 'project_state', label: 'Estado do projeto' },
                { type: 'decisions_log', label: 'Decisões' },
                { type: 'next_actions', label: 'Próximas ações' },
                { type: 'work_journal', label: 'Diário' },
              ]
              const activeDoc = projectDocs.find(d => d.type === activeDocType)
              return (
                <>
                  <div className="flex gap-1 px-6 pt-4 pb-0">
                    {DOC_TABS.map(tab => (
                      <button
                        key={tab.type}
                        onClick={() => setActiveDocType(tab.type)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${activeDocType === tab.type ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'}`}
                      >
                        {tab.label}
                        {projectDocs.find(d => d.type === tab.type)?.reviewedAt && (
                          <span className="ml-1 text-emerald-500">✓</span>
                        )}
                      </button>
                    ))}
                  </div>
                  <div className="flex-1 overflow-y-auto px-6 py-4">
                    {docsLoading && <p className="text-zinc-500 text-xs text-center py-8">Carregando…</p>}
                    {!docsLoading && !activeDoc && (
                      <div className="text-center py-8">
                        <p className="text-zinc-500 text-xs mb-3">Documento não gerado ainda.</p>
                        <button
                          onClick={generateAllDocs}
                          disabled={generatingDocs}
                          className="text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-300 px-4 py-2 rounded-lg transition-colors disabled:opacity-40"
                        >
                          {generatingDocs ? 'Gerando…' : 'Gerar agora'}
                        </button>
                      </div>
                    )}
                    {!docsLoading && activeDoc && (
                      <div>
                        <div className="flex items-center justify-between mb-3">
                          <span className="text-[10px] text-zinc-600">
                            Gerado em {new Date(activeDoc.generatedAt).toLocaleString('pt-BR')}
                            {activeDoc.reviewedAt && ` · revisado ${new Date(activeDoc.reviewedAt).toLocaleString('pt-BR')}`}
                          </span>
                          <button
                            onClick={() => openVersions(activeDocType)}
                            className="text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors underline"
                          >
                            ver histórico
                          </button>
                        </div>
                        <div className="prose prose-invert prose-sm max-w-none">
                          <ReactMarkdown>{activeDoc.content}</ReactMarkdown>
                        </div>
                      </div>
                    )}
                  </div>
                </>
              )
            })()}
          </div>
        </div>
      )}

      {/* Synthesis modal */}
      {synthesisOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="fixed inset-0 bg-black/70" onClick={() => setSynthesisOpen(false)} />
          <div className="relative z-50 w-full max-w-xl bg-zinc-900 border border-zinc-800 rounded-2xl p-6 mx-4 max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold">Síntese de sessões</h2>
              <div className="flex items-center gap-3">
                <button
                  onClick={synthesizeCurrent}
                  disabled={synthesizing}
                  className="text-xs bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white px-3 py-1.5 rounded-lg transition-colors"
                >
                  {synthesizing ? 'Sintetizando…' : 'Sintetizar sessão atual'}
                </button>
                <button onClick={() => setSynthesisOpen(false)} className="text-zinc-500 hover:text-zinc-300 text-xs">fechar</button>
              </div>
            </div>
            <div className="overflow-y-auto flex-1 space-y-4">
              {synthesisLoading && <p className="text-zinc-500 text-xs text-center py-4">Carregando…</p>}
              {!synthesisLoading && synthesisArtifacts.length === 0 && (
                <p className="text-zinc-500 text-xs text-center py-4">Nenhuma síntese ainda. Clique em "Sintetizar sessão atual" para começar.</p>
              )}
              {synthesisArtifacts.map((a) => (
                <div key={a.id} className="border border-zinc-800 rounded-xl p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-zinc-500 font-mono">{new Date(a.createdAt).toLocaleString('pt-BR')}</span>
                      {a.type === 'checkpoint' && (
                        <span className="text-[9px] bg-amber-900 text-amber-300 px-1.5 py-0.5 rounded-full font-medium">checkpoint</span>
                      )}
                      {a.content.confidence && (
                        <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium ${
                          a.content.confidence === 'high' ? 'bg-emerald-900 text-emerald-300' :
                          a.content.confidence === 'medium' ? 'bg-zinc-700 text-zinc-300' :
                          'bg-zinc-800 text-zinc-500'
                        }`}>{a.content.confidence}</span>
                      )}
                    </div>
                    <span className="text-[10px] text-zinc-600 font-mono truncate ml-2">{a.sessionId.slice(0, 8)}…</span>
                  </div>
                  <p className="text-xs text-zinc-300">{a.content.summary}</p>
                  {a.content.decisions.length > 0 && (
                    <div>
                      <p className="text-[10px] font-semibold text-indigo-400 mb-1">Decisões</p>
                      <ul className="space-y-0.5">{a.content.decisions.map((d, i) => <li key={i} className="text-xs text-zinc-400">· {d}</li>)}</ul>
                    </div>
                  )}
                  {a.content.next_steps.length > 0 && (
                    <div>
                      <p className="text-[10px] font-semibold text-amber-400 mb-1">Próximos passos</p>
                      <ul className="space-y-0.5">{a.content.next_steps.map((s, i) => <li key={i} className="text-xs text-zinc-400">· {s}</li>)}</ul>
                    </div>
                  )}
                  {a.content.learnings.length > 0 && (
                    <div>
                      <p className="text-[10px] font-semibold text-emerald-400 mb-1">Aprendizados</p>
                      <ul className="space-y-0.5">{a.content.learnings.map((l, i) => <li key={i} className="text-xs text-zinc-400">· {l}</li>)}</ul>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Memory panel */}
      {memoryOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="fixed inset-0 bg-black/70" onClick={() => setMemoryOpen(false)} />
          <div className="relative z-50 w-full max-w-lg bg-zinc-900 border border-zinc-800 rounded-2xl p-6 mx-4 flex flex-col max-h-[80vh]">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-sm font-semibold text-zinc-200">Memória indexada</h2>
                {!memoryDocsLoading && <p className="text-xs text-zinc-500 mt-0.5">{memoryDocs.length} documentos</p>}
              </div>
              <button onClick={() => setMemoryOpen(false)} className="text-zinc-500 hover:text-zinc-300 text-xl leading-none">×</button>
            </div>

            {/* Search */}
            <div className="flex gap-2 mb-4">
              <input
                value={memorySearch}
                onChange={(e) => setMemorySearch(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleMemorySearch() }}
                placeholder="Buscar na memória…"
                className="flex-1 bg-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 outline-none focus:ring-1 focus:ring-zinc-600"
              />
              <button
                onClick={handleMemorySearch}
                disabled={memorySearching || !memorySearch.trim()}
                className="bg-zinc-700 hover:bg-zinc-600 text-zinc-200 rounded-lg px-3 py-2 text-xs font-medium disabled:opacity-40 transition-colors"
              >
                {memorySearching ? '…' : 'Buscar'}
              </button>
              {memorySearchResults !== null && (
                <button
                  onClick={() => { setMemorySearch(''); setMemorySearchResults(null) }}
                  className="text-zinc-500 hover:text-zinc-300 text-xs px-2"
                >limpar</button>
              )}
            </div>

            {/* Results */}
            <div className="overflow-y-auto flex-1 space-y-2 pr-1">
              {memoryDocsLoading && <p className="text-xs text-zinc-500 text-center py-8">Carregando…</p>}

              {/* Search results */}
              {memorySearchResults !== null && !memorySearching && (
                <>
                  {memorySearchResults.length === 0 && (
                    <p className="text-xs text-zinc-500 text-center py-8">Nenhum resultado encontrado</p>
                  )}
                  {memorySearchResults.map((r) => (
                    <div key={r.id} className="bg-zinc-800 rounded-xl p-3">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[11px] text-zinc-500 truncate">{r.sourcePath ?? 'sem origem'}</span>
                        <span className="text-[11px] text-zinc-600 ml-2 shrink-0">{(r.score * 100).toFixed(0)}%</span>
                      </div>
                      <p className="text-xs text-zinc-300 line-clamp-3">{r.content}</p>
                    </div>
                  ))}
                </>
              )}

              {/* Document list */}
              {memorySearchResults === null && !memoryDocsLoading && (() => {
                const groups = memoryDocs.reduce<Record<string, { ids: string[]; count: number }>>((acc, d) => {
                  const key = d.sourcePath?.split('/').slice(0, 2).join('/') ?? 'sem origem'
                  if (!acc[key]) acc[key] = { ids: [], count: 0 }
                  acc[key].ids.push(d.id)
                  acc[key].count++
                  return acc
                }, {})
                return Object.entries(groups).sort((a, b) => b[1].count - a[1].count).map(([source, { ids, count }]) => (
                  <div key={source} className="flex items-center justify-between bg-zinc-800 rounded-xl px-3 py-2 group">
                    <span className="text-xs text-zinc-300 truncate">{source}</span>
                    <div className="flex items-center gap-2 ml-2 shrink-0">
                      <span className="text-[11px] text-zinc-500">{count} chunk{count !== 1 ? 's' : ''}</span>
                      <button
                        onClick={async () => {
                          if (!confirm(`Deletar todos os ${count} chunks de "${source}"?`)) return
                          await Promise.all(ids.map(id =>
                            fetch(`${API_URL}/memory/documents/${id}`, { method: 'DELETE', headers: authHeaders() })
                          ))
                          setMemoryDocs(prev => prev.filter(d => !ids.includes(d.id)))
                        }}
                        className="opacity-0 group-hover:opacity-100 text-zinc-600 hover:text-red-400 transition-all"
                        title="Deletar todos os chunks desta origem"
                      >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <polyline points="3 6 5 6 21 6"/>
                          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                          <path d="M10 11v6M14 11v6"/>
                          <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
                        </svg>
                      </button>
                    </div>
                  </div>
                ))
              })()}
            </div>
          </div>
        </div>
      )}

      {/* Import modal */}
      {importOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="fixed inset-0 bg-black/70" onClick={() => { setImportOpen(false); setImportResult(null) }} />
          <div className="relative z-50 w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-2xl p-6 mx-4">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-zinc-200">Indexar no Brain</h2>
              <button onClick={() => { setImportOpen(false); setImportResult(null) }} className="text-zinc-500 hover:text-zinc-300 text-xl leading-none">×</button>
            </div>

            {/* Tabs */}
            <div className="flex gap-1 mb-4 bg-zinc-800 rounded-lg p-1">
              {(['github', 'notion', 'file', 'url'] as ImportTab[]).map((tab) => (
                <button
                  key={tab}
                  onClick={() => { setImportTab(tab); setImportResult(null) }}
                  className={`flex-1 py-1.5 rounded-md text-xs font-medium transition-colors ${
                    importTab === tab ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'
                  }`}
                >
                  {tab === 'github' ? 'GitHub' : tab === 'notion' ? 'Notion' : tab === 'file' ? 'Arquivo' : 'URL'}
                </button>
              ))}
            </div>

            {/* GitHub tab */}
            {importTab === 'github' && (
              <div className="space-y-3">
                <div>
                  <label className="text-xs text-zinc-500 mb-1 block">Usuário GitHub</label>
                  <input
                    value={githubUser}
                    onChange={(e) => setGithubUser(e.target.value)}
                    placeholder="ex: marcelorayzen"
                    className="w-full bg-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 outline-none focus:ring-1 focus:ring-zinc-600"
                  />
                </div>
                <div>
                  <label className="text-xs text-zinc-500 mb-1 block">Token (opcional — para repos privados)</label>
                  <input
                    value={githubToken}
                    onChange={(e) => setGithubToken(e.target.value)}
                    type="password"
                    placeholder="ghp_..."
                    className="w-full bg-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 outline-none focus:ring-1 focus:ring-zinc-600"
                  />
                </div>
                <button
                  onClick={handleImportGithub}
                  disabled={importLoading || !githubUser.trim()}
                  className="w-full bg-zinc-100 text-zinc-900 rounded-lg py-2 text-sm font-medium disabled:opacity-40 hover:bg-white transition-colors"
                >
                  {importLoading ? 'Indexando…' : 'Indexar repositórios'}
                </button>
              </div>
            )}

            {/* Notion tab */}
            {importTab === 'notion' && (
              <div className="space-y-3">
                <div>
                  <label className="text-xs text-zinc-500 mb-1 block">Integration Token</label>
                  <input
                    value={notionToken}
                    onChange={(e) => setNotionToken(e.target.value)}
                    type="password"
                    placeholder="secret_..."
                    className="w-full bg-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 outline-none focus:ring-1 focus:ring-zinc-600"
                  />
                  <p className="text-[11px] text-zinc-600 mt-1">Crie em notion.so/my-integrations e compartilhe as páginas com ela</p>
                </div>
                <div>
                  <label className="text-xs text-zinc-500 mb-1 block">ID ou URL da página (opcional — indexa tudo se vazio)</label>
                  <input
                    value={notionPageId}
                    onChange={(e) => setNotionPageId(e.target.value)}
                    placeholder="https://notion.so/... ou UUID"
                    className="w-full bg-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 outline-none focus:ring-1 focus:ring-zinc-600"
                  />
                </div>
                <button
                  onClick={handleImportNotion}
                  disabled={importLoading || !notionToken.trim()}
                  className="w-full bg-zinc-100 text-zinc-900 rounded-lg py-2 text-sm font-medium disabled:opacity-40 hover:bg-white transition-colors"
                >
                  {importLoading ? 'Indexando…' : 'Indexar páginas Notion'}
                </button>
              </div>
            )}

            {/* File tab */}
            {importTab === 'file' && (
              <div className="space-y-3">
                <p className="text-xs text-zinc-500">Suporta PDF, TXT, MD e outros arquivos de texto.</p>
                <label className={`flex flex-col items-center justify-center w-full h-28 border-2 border-dashed border-zinc-700 rounded-xl cursor-pointer hover:border-zinc-500 transition-colors ${importLoading ? 'opacity-40 pointer-events-none' : ''}`}>
                  <span className="text-zinc-500 text-sm">{importLoading ? 'Indexando…' : 'Clique ou arraste o arquivo aqui'}</span>
                  <span className="text-zinc-700 text-xs mt-1">.pdf, .txt, .md, .ts, .json, .yaml…</span>
                  <input type="file" multiple accept=".pdf,.txt,.md,.ts,.tsx,.js,.jsx,.json,.yaml,.yml,.toml,.env.example,.sh,.sql,.csv" className="hidden" onChange={handleImportFile} />
                </label>
              </div>
            )}

            {/* URL tab */}
            {importTab === 'url' && (
              <div className="space-y-3">
                <div>
                  <label className="text-xs text-zinc-500 mb-1 block">URL da página</label>
                  <input
                    value={importUrl}
                    onChange={(e) => setImportUrl(e.target.value)}
                    placeholder="https://..."
                    className="w-full bg-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 outline-none focus:ring-1 focus:ring-zinc-600"
                  />
                </div>
                <button
                  onClick={handleImportUrl}
                  disabled={importLoading || !importUrl.trim()}
                  className="w-full bg-zinc-100 text-zinc-900 rounded-lg py-2 text-sm font-medium disabled:opacity-40 hover:bg-white transition-colors"
                >
                  {importLoading ? 'Indexando…' : 'Indexar página'}
                </button>
              </div>
            )}

            {importResult && (
              <p className={`mt-3 text-xs rounded-lg px-3 py-2 ${importResult.startsWith('Erro') ? 'bg-red-950 text-red-400' : 'bg-zinc-800 text-zinc-300'}`}>
                {importResult}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Sidebar overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 flex">
          <div
            className="fixed inset-0 bg-black/60"
            onClick={() => setSidebarOpen(false)}
          />
          <div className="relative z-50 w-72 bg-zinc-900 border-r border-zinc-800 flex flex-col h-full">
            <div className="px-4 py-4 border-b border-zinc-800 flex items-center justify-between">
              <span className="text-sm font-semibold text-zinc-200">Histórico</span>
              <button
                onClick={() => setSidebarOpen(false)}
                className="text-zinc-500 hover:text-zinc-300 text-lg leading-none"
              >
                ×
              </button>
            </div>

            <div className="px-3 py-3 border-b border-zinc-800">
              <button
                onClick={newChat}
                className="w-full rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-sm py-2 px-3 text-left transition-colors"
              >
                + Nova conversa
              </button>
            </div>

            <div className="flex-1 overflow-y-auto py-2">
              {sessions.length === 0 && (
                <p className="text-xs text-zinc-600 px-4 py-3">Nenhuma conversa ainda</p>
              )}
              {sessions.map((s) => (
                <div
                  key={s.sessionId}
                  className={`group relative border-b border-zinc-800/50 ${
                    s.sessionId === sessionId ? 'bg-zinc-800' : 'hover:bg-zinc-800'
                  } transition-colors`}
                >
                  <button
                    onClick={() => loadSession(s.sessionId)}
                    disabled={loadingSession === s.sessionId}
                    className={`w-full text-left px-4 py-3 pr-10 ${loadingSession === s.sessionId ? 'opacity-50' : ''}`}
                  >
                    <p className="text-sm text-zinc-200 truncate">{s.title}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-xs text-zinc-600">{s.messages} msgs</span>
                      <span className="text-xs text-zinc-700">·</span>
                      <span className="text-xs text-zinc-600">{formatRelativeTime(s.lastActivity ?? '')}</span>
                    </div>
                  </button>
                  <button
                    onClick={(e) => deleteSession(s.sessionId, e)}
                    disabled={deletingSession === s.sessionId}
                    className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 text-zinc-600 hover:text-red-400 transition-all p-1 rounded"
                    title="Deletar conversa"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="3 6 5 6 21 6" />
                      <path d="M19 6l-1 14H6L5 6" />
                      <path d="M10 11v6M14 11v6" />
                      <path d="M9 6V4h6v2" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="border-b border-zinc-800 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={openSidebar}
            className="text-zinc-400 hover:text-zinc-200 transition-colors"
            title="Histórico de conversas"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>
          <button
            onClick={() => router.push('/settings')}
            className="text-zinc-400 hover:text-zinc-200 transition-colors"
            title="Configurações"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="3"/>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
            </svg>
          </button>
          <button
            onClick={openMemoryPanel}
            className="text-zinc-400 hover:text-zinc-200 transition-colors"
            title="Memória indexada"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <ellipse cx="12" cy="5" rx="9" ry="3"/>
              <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/>
              <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>
            </svg>
          </button>
          <button
            onClick={() => { setImportOpen(true); setImportResult(null) }}
            className="text-zinc-400 hover:text-zinc-200 transition-colors"
            title="Indexar no Brain"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
          </button>
          <div>
            <h1 className="text-lg font-semibold">Rayzen AI</h1>
            <p className="text-xs text-zinc-500 mt-0.5">Sessão: {sessionId.slice(0, 8)}…</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1">
            <select
              value={activeProjectId ?? ''}
              onChange={(e) => setActiveProjectId(e.target.value || null)}
              className="bg-zinc-800 border border-zinc-700 text-zinc-300 text-xs rounded-lg px-2 py-1.5 focus:outline-none focus:border-zinc-500"
            >
              <option value="">sem projeto</option>
              {projects.filter((p) => p.status === 'active').map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <button
              onClick={() => setNewProjectOpen(true)}
              className="text-zinc-500 hover:text-zinc-200 transition-colors w-6 h-6 flex items-center justify-center rounded-md hover:bg-zinc-700 text-base leading-none"
              title="Novo projeto"
            >+</button>
            {activeProjectId && (() => {
              const proj = projects.find((p) => p.id === activeProjectId)
              return proj ? (
                <>
                  <button
                    onClick={() => renameProject(proj.id, proj.name)}
                    className="text-zinc-600 hover:text-zinc-300 transition-colors w-6 h-6 flex items-center justify-center rounded-md hover:bg-zinc-700"
                    title="Renomear projeto"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                    </svg>
                  </button>
                  <button
                    onClick={() => deleteProject(proj.id)}
                    className="text-zinc-600 hover:text-red-400 transition-colors w-6 h-6 flex items-center justify-center rounded-md hover:bg-zinc-700"
                    title="Deletar projeto"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="3 6 5 6 21 6"/>
                      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                      <path d="M10 11v6M14 11v6"/>
                      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
                    </svg>
                  </button>
                </>
              ) : null
            })()}
          </div>
          {activeProjectId && (
            <select
              value={workMode ?? ''}
              onChange={(e) => setWorkMode((e.target.value as WorkMode) || null)}
              className="bg-zinc-800 border border-zinc-700 text-zinc-300 text-xs rounded-lg px-2 py-1.5 focus:outline-none focus:border-zinc-500"
              title="Modo de trabalho"
            >
              <option value="">modo livre</option>
              <option value="implementation">implementação</option>
              <option value="debugging">debugging</option>
              <option value="architecture">arquitetura</option>
              <option value="study">estudo</option>
              <option value="review">revisão</option>
            </select>
          )}
          {activeProjectId && projectState && (
            <button
              onClick={() => setStateOpen(true)}
              className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
              title="Ver estado do projeto"
            >
              <div className={`w-2 h-2 rounded-full ${RISK_COLORS[projectState.riskLevel]}`} />
              {STAGE_LABELS[projectState.stage] ?? projectState.stage}
            </button>
          )}
          {activeProjectId && healthData?.current && (
            <button
              onClick={() => setHealthOpen(true)}
              className={`flex items-center gap-1 text-xs font-mono font-semibold transition-colors ${
                healthData.current.score >= 70 ? 'text-emerald-400 hover:text-emerald-300' :
                healthData.current.score >= 40 ? 'text-amber-400 hover:text-amber-300' :
                                                  'text-red-400 hover:text-red-300'
              }`}
              title="Health score do projeto"
            >
              ⬡ {healthData.current.score}
            </button>
          )}
          {activeProjectId && gitContext && gitContext.lastBranch && (
            <button
              onClick={() => setGitOpen(true)}
              className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-300 transition-colors font-mono"
              title="Ver contexto git do projeto"
            >
              ⎇ {gitContext.lastBranch}
            </button>
          )}
          {activeProjectId && (
            <button
              onClick={openRecommendations}
              className="relative flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
              title="Recomendações proativas"
            >
              {recommendations.length > 0 && (
                <span className={`flex items-center justify-center w-4 h-4 rounded-full text-[9px] font-bold ${
                  recommendations.some(r => r.priority === 'high')   ? 'bg-red-500 text-white' :
                  recommendations.some(r => r.priority === 'medium') ? 'bg-amber-500 text-zinc-900' :
                                                                       'bg-zinc-600 text-zinc-300'
                }`}>{recommendations.length}</span>
              )}
              recomendações
            </button>
          )}
          {activeProjectId && (
            <button
              onClick={() => setQuickCaptureOpen(true)}
              className="text-zinc-500 hover:text-zinc-300 transition-colors text-xs"
              title="Captura rápida: decisão, ideia, problema"
            >
              + capturar
            </button>
          )}
          {activeProjectId && (
            <button
              onClick={doCheckpoint}
              disabled={checkpointing}
              className="text-zinc-500 hover:text-zinc-300 disabled:opacity-40 transition-colors text-xs"
              title="Checkpoint: sintetiza atividade recente"
            >
              {checkpointing ? '…' : 'checkpoint'}
            </button>
          )}
          <button
            onClick={openActivity}
            className="text-zinc-500 hover:text-zinc-300 transition-colors text-xs"
          >
            atividade
          </button>
          <button
            onClick={openSynthesis}
            className="text-zinc-500 hover:text-zinc-300 transition-colors text-xs"
          >
            síntese
          </button>
          {activeProjectId && (
            <button
              onClick={openDocs}
              className="text-zinc-500 hover:text-zinc-300 transition-colors text-xs"
            >
              docs
            </button>
          )}
          <button
            onClick={() => {
              document.cookie = 'rayzen_token=; path=/; max-age=0'
              localStorage.removeItem('rayzen_token')
              router.push('/login')
            }}
            className="text-zinc-600 hover:text-zinc-400 transition-colors text-xs"
            title="Sair"
          >
            sair
          </button>
          {sessionTokens > 0 && (
            <div className="flex flex-col items-end">
              <span className="text-xs text-zinc-400">
                <span className="font-medium text-zinc-200">{sessionTokens.toLocaleString()}</span> tokens sessão
              </span>
              {dailyTokens !== null && (
                <span className="text-xs text-zinc-600">
                  {dailyTokens.toLocaleString()} hoje
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-6 flex flex-col gap-4 max-w-3xl w-full mx-auto">
        {messages.length === 0 && (
          <div className="text-center text-zinc-600 text-sm mt-20">Diga algo para começar…</div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                msg.role === 'user' ? 'bg-zinc-100 text-zinc-900' : 'bg-zinc-800 text-zinc-100'
              }`}
            >
              {msg.role === 'assistant' ? (
                <div className="prose prose-invert prose-sm max-w-none">
                  <ReactMarkdown
                    components={{
                      a: ({ href, children }: { href?: string; children?: React.ReactNode }) => {
                        const url = href?.startsWith('/') ? `${API_URL}${href}` : (href ?? '#')
                        const isDownload = href?.startsWith('/documents/download/') ?? false
                        return (
                          <a href={url} target="_blank" rel="noopener noreferrer" download={isDownload || undefined} className="text-indigo-400 underline hover:text-indigo-300">
                            {children}
                          </a>
                        )
                      },
                    }}
                  >
                    {msg.content.replace(/\n?\[DOC_PENDING:[A-Za-z0-9+/=]*\]/g, '').trim()}
                  </ReactMarkdown>
                </div>
              ) : (
                msg.content
              )}

              {msg.role === 'assistant' && (
                <div className="mt-2 flex items-center gap-3">
                  {msg.module && (
                    <span className="text-xs text-zinc-500">módulo: {MODULE_LABELS[msg.module] ?? msg.module}</span>
                  )}
                  {workMode && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-700 text-zinc-400 font-mono">{workMode}</span>
                  )}
                  <button
                    onClick={() => playAudio(msg.content, i)}
                    className="text-xs text-zinc-400 hover:text-zinc-200 transition-colors flex items-center gap-1"
                    title={playingIndex === i ? 'Pausar' : 'Ouvir resposta'}
                  >
                    {playingIndex === i ? (
                      <span>⏸ pausar</span>
                    ) : (
                      <span>🔊 ouvir</span>
                    )}
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-zinc-800 rounded-2xl px-4 py-3 text-sm text-zinc-400">Pensando…</div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="border-t border-zinc-800 px-4 py-4">
        <form onSubmit={handleSubmit} className="flex gap-2 max-w-3xl mx-auto">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                if (input.trim() && !loading) handleSubmit(e as unknown as React.FormEvent)
              }
            }}
            placeholder="Digite uma mensagem ou use o microfone…"
            disabled={loading}
            rows={1}
            className="flex-1 rounded-xl bg-zinc-800 px-4 py-3 text-sm outline-none placeholder:text-zinc-500 focus:ring-2 focus:ring-zinc-600 disabled:opacity-50 resize-none"
          />
          <button
            type="button"
            onClick={toggleRecording}
            disabled={loading || transcribing}
            title={recording ? 'Parar gravação' : transcribing ? 'Transcrevendo…' : 'Gravar áudio'}
            className={`rounded-xl px-4 py-3 text-sm font-medium transition-colors disabled:opacity-40 ${
              recording
                ? 'bg-red-500 text-white animate-pulse'
                : transcribing
                ? 'bg-zinc-600 text-zinc-300 animate-pulse'
                : 'bg-zinc-700 text-zinc-200 hover:bg-zinc-600'
            }`}
          >
            {recording ? '⏹' : transcribing ? '…' : '🎤'}
          </button>
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="rounded-xl bg-zinc-100 px-5 py-3 text-sm font-medium text-zinc-900 disabled:opacity-40 hover:bg-white transition-colors"
          >
            Enviar
          </button>
        </form>
      </div>
    </main>
  )
}
