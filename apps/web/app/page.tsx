'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { API_URL } from '../lib/api-url'

function authHeaders(extra?: Record<string, string>): Record<string, string> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('rayzen_token') : null
  return {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    'ngrok-skip-browser-warning': 'true',
    ...(extra ?? {}),
  }
}
import { useRouter } from 'next/navigation'
import ReactMarkdown from 'react-markdown'
import dynamic from 'next/dynamic'
const GraphCanvas = dynamic(() => import('./components/GraphCanvas'), { ssr: false })

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

function isProject(value: unknown): value is Project {
  if (!value || typeof value !== 'object') return false
  const project = value as Partial<Project>
  return typeof project.id === 'string' && typeof project.name === 'string' && typeof project.status === 'string'
}

function projectListFromResponse(data: unknown): Project[] {
  if (Array.isArray(data)) return data.filter(isProject)
  if (!data || typeof data !== 'object') return []

  const payload = data as { projects?: unknown; items?: unknown; data?: unknown }
  if (Array.isArray(payload.projects)) return payload.projects.filter(isProject)
  if (Array.isArray(payload.items)) return payload.items.filter(isProject)
  if (Array.isArray(payload.data)) return payload.data.filter(isProject)
  return []
}

interface ActivityEvent {
  id: string
  source: string
  type: string
  content: string
  metadata: Record<string, unknown>
  ts: string
  memoryClass?: string
  project?: { id: string; name: string } | null
}

interface ProjectDoc {
  id: string
  type: string
  content: string
  generatedAt: string
  reviewedAt: string | null
}

interface MemoryDoc {
  id: string
  sourcePath: string | null
  metadata?: Record<string, unknown> | null
  projectId?: string | null
  createdAt: string
}

function memoryGroupFor(doc: MemoryDoc): { key: string; label: string } {
  const meta = doc.metadata ?? {}
  const metaKey = typeof meta.groupKey === 'string' ? meta.groupKey : null
  const metaLabel = typeof meta.groupLabel === 'string' ? meta.groupLabel : null
  if (metaKey) return { key: metaKey, label: metaLabel ?? metaKey }

  const source = doc.sourcePath ?? 'sem origem'
  const parts = source.split('/')
  if (parts[0] === 'github' && parts.length >= 3) {
    const repo = `${parts[1]}/${parts[2]}`
    return { key: `github/${repo}`, label: repo }
  }
  if (parts[0] === 'notion' && parts[1]) return { key: `notion/${parts[1]}`, label: `Notion ${parts[1].slice(0, 8)}` }
  if (parts[0] === 'url' && parts[1]) return { key: `url/${parts[1]}`, label: parts[1] }
  if (parts[0] === 'file') return { key: source, label: parts.slice(1).join('/') || source }
  return { key: source, label: source }
}

type MemoryDocType = 'code' | 'config' | 'doc' | 'qa' | 'catalog' | 'notion' | 'github' | 'url' | 'memory' | 'other'

// Extrai nome do projeto a partir do caminho no filesystem (ex: .../Projects/rayzen-ai/...)
function projectLabelFromPath(path: string | null): string | null {
  if (!path) return null
  const m = path.replace(/\\/g, '/').match(/\/Projects\/([^/]+)\//i)
  return m ? m[1] : null
}

// Extrai caminho relativo dentro do projeto (ex: apps/api/src/modules/memory/)
function relativePathFromFull(path: string | null): string | null {
  if (!path) return null
  const norm = path.replace(/\\/g, '/')
  const m = norm.match(/\/Projects\/[^/]+\/(.+)/)
  if (!m) return null
  const parts = m[1].split('/')
  parts.pop() // remove filename
  return parts.join('/') || null
}

function memoryDocType(sourcePath: string | null, metadata?: Record<string, unknown> | null): MemoryDocType {
  const metaType = typeof metadata?.type === 'string' ? metadata.type : null
  if (metaType === 'test_failures') return 'qa'
  if (metaType === 'data_asset') return 'catalog'

  const s = sourcePath ?? ''
  // prefixos especiais primeiro
  if (s.startsWith('qa/')) return 'qa'
  if (s.startsWith('data-catalog/')) return 'catalog'
  if (s.startsWith('notion/') || s.startsWith('Notion')) return 'notion'
  if (s.startsWith('github/')) return 'github'
  if (s.startsWith('url/')) return 'url'
  // extensão tem prioridade sobre heurísticas de path
  if (/\.(ts|tsx|js|jsx|py|java|go|rs|cs|php|rb|swift|kt)$/i.test(s)) return 'code'
  if (/\.(json|yaml|yml|env|toml|ini|cfg)$/i.test(s)) return 'config'
  if (/\.(md|txt|pdf|docx|rst)$/i.test(s)) return 'doc'
  // só depois verifica se é path de memória do Claude
  if (s.includes('.claude') && s.includes('memory')) return 'memory'
  if (s.startsWith('apps/') || s.startsWith('src/') || s.startsWith('packages/')) return 'code'
  return 'other'
}

const DOC_TYPE_LABELS: Record<MemoryDocType, string> = {
  code: 'Código', config: 'Config', doc: 'Doc', qa: 'QA',
  catalog: 'Catálogo', notion: 'Notion', github: 'GitHub',
  url: 'URL', memory: 'Memória', other: 'Outro',
}

const DOC_TYPE_COLORS: Record<MemoryDocType, string> = {
  code:    'bg-blue-500/15 text-blue-400',
  config:  'bg-zinc-500/20 text-zinc-400',
  doc:     'bg-purple-500/15 text-purple-400',
  qa:      'bg-green-500/15 text-green-400',
  catalog: 'bg-cyan-500/15 text-cyan-400',
  notion:  'bg-orange-500/15 text-orange-400',
  github:  'bg-zinc-400/15 text-zinc-300',
  url:     'bg-yellow-500/15 text-yellow-400',
  memory:  'bg-pink-500/15 text-pink-400',
  other:   'bg-zinc-700/30 text-zinc-500',
}

// Cores por projeto — rotaciona entre paletas
const PROJECT_COLORS = [
  'bg-indigo-500/20 text-indigo-300',
  'bg-emerald-500/20 text-emerald-300',
  'bg-rose-500/20 text-rose-300',
  'bg-amber-500/20 text-amber-300',
  'bg-sky-500/20 text-sky-300',
  'bg-violet-500/20 text-violet-300',
]

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
type MemoryClassFilter = 'all' | 'global' | 'inbox' | 'working' | 'consolidated' | 'archive'
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

interface SuccessCriteria { id: string; text: string; done: boolean }
interface GapItem { area: string; description: string; severity: 'high' | 'medium' | 'low'; relatedCriteria?: string }
interface GapAnalysis { gaps: GapItem[]; nextBestAction: string; goalProgress: number; confidence: 'low' | 'medium' | 'high' }
interface ProjectGoal {
  id: string; title: string; description?: string
  successCriteria: SuccessCriteria[]
  kpis: Array<{ metric: string; target: string; current?: string; unit?: string }>
  status: string; targetDate?: string; createdAt: string
}
interface GoalGraphData {
  goal: ProjectGoal | null; state: ProjectState | null; mermaid: string
  gapAnalysis: GapAnalysis | null; healthScore: number; updatedAt: string
}

function GoalHistoryCard({ g, isActive, total, done, pct }: {
  g: ProjectGoal; isActive: boolean; total: number; done: number; pct: number | null
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className={`rounded-xl border ${isActive ? 'border-zinc-600 bg-zinc-800' : 'border-zinc-800 bg-zinc-900'}`}>
      <button className="w-full text-left px-3 py-2.5" onClick={() => setOpen(o => !o)}>
        <div className="flex items-start justify-between gap-2">
          <span className="text-xs text-zinc-300 leading-snug">{g.title}</span>
          <div className="flex items-center gap-1.5 shrink-0">
            <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${
              g.status === 'active'   ? 'bg-blue-500/20 text-blue-400' :
              g.status === 'achieved' ? 'bg-emerald-500/20 text-emerald-400' :
              g.status === 'paused'   ? 'bg-zinc-700 text-zinc-400' :
              'bg-red-500/20 text-red-400'
            }`}>{g.status}</span>
            <span className="text-zinc-600 text-xs">{open ? '▲' : '▼'}</span>
          </div>
        </div>
        <div className="flex items-center gap-3 mt-1.5">
          <span className="text-[10px] text-zinc-600">{new Date(g.createdAt).toLocaleDateString('pt-BR')}</span>
          {pct !== null && (
            <>
              <div className="flex-1 h-1 bg-zinc-700 rounded-full overflow-hidden">
                <div className={`h-full rounded-full transition-all ${g.status === 'achieved' ? 'bg-emerald-500' : 'bg-blue-500'}`}
                  style={{ width: `${pct}%` }} />
              </div>
              <span className="text-[10px] text-zinc-500 shrink-0">{done}/{total}</span>
            </>
          )}
          {g.targetDate && (
            <span className="text-[10px] text-zinc-600">prazo {new Date(g.targetDate).toLocaleDateString('pt-BR')}</span>
          )}
        </div>
      </button>
      {open && g.successCriteria.length > 0 && (
        <div className="px-3 pb-3 space-y-1.5 border-t border-zinc-800 pt-2">
          {g.successCriteria.map(c => (
            <div key={c.id} className="flex items-start gap-2">
              <span className={`mt-0.5 shrink-0 text-xs ${c.done ? 'text-emerald-500' : 'text-zinc-600'}`}>
                {c.done ? '✓' : '○'}
              </span>
              <span className={`text-xs leading-snug ${c.done ? 'text-zinc-400 line-through decoration-zinc-600' : 'text-zinc-400'}`}>
                {c.text}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [sessionId, setSessionId] = useState('')
  const [playingIndex, setPlayingIndex] = useState<number | null>(null)
  const [autoVoice, setAutoVoice] = useState(false)
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
  const [newProjectSlug, setNewProjectSlug] = useState('')
  const [creatingProject, setCreatingProject] = useState(false)
  const [onboardStep, setOnboardStep] = useState<1 | 2 | 3>(1)
  const [onboardProjectId, setOnboardProjectId] = useState<string | null>(null)
  const [onboardSrcTab, setOnboardSrcTab] = useState<'github' | 'notion' | 'skip'>('github')
  const [onboardIndexing, setOnboardIndexing] = useState(false)
  const [onboardGoalTitle, setOnboardGoalTitle] = useState('')
  const [onboardGoalDate, setOnboardGoalDate] = useState('')
  const [onboardGoalCriteria, setOnboardGoalCriteria] = useState<string[]>([''])
  const [onboardSavingGoal, setOnboardSavingGoal] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [importTab, setImportTab] = useState<ImportTab>('github')
  const [importLoading, setImportLoading] = useState(false)
  const [importResult, setImportResult] = useState<string | null>(null)
  const [githubUser, setGithubUser] = useState('')
  const [githubRepo, setGithubRepo] = useState('')
  const [githubToken, setGithubToken] = useState('')
  const [importUrl, setImportUrl] = useState('')
  const [notionToken, setNotionToken] = useState('')
  const [notionPageId, setNotionPageId] = useState('')
  const [memoryOpen, setMemoryOpen] = useState(false)
  const [memoryDocs, setMemoryDocs] = useState<MemoryDoc[]>([])
  const [memoryDocsLoading, setMemoryDocsLoading] = useState(false)
  const [memorySearch, setMemorySearch] = useState('')
  const [memoryListFilter, setMemoryListFilter] = useState('')
  const [memorySearchResults, setMemorySearchResults] = useState<Array<{ id: string; content: string; sourcePath: string | null; score: number }> | null>(null)
  const [memorySearching, setMemorySearching] = useState(false)
  const [graphOpen, setGraphOpen] = useState(false)
  const [graphSubMode, setGraphSubMode] = useState<'estado' | 'goal' | 'eventos'>('estado')
  const [graphEventData, setGraphEventData] = useState<{ milestones: Array<{ id: string; title: string; status: string }>; events: Array<{ id: string; content: string; intent: string | null; type: string; source: string; ts: string; milestoneId: string | null }> } | null>(null)
  const [graphEventLoading, setGraphEventLoading] = useState(false)
  const [graphStateData, setGraphStateData] = useState<ProjectState | null>(null)
  const [graphGoalData, setGraphGoalData] = useState<GoalGraphData | null>(null)
  const [graphLoading, setGraphLoading] = useState(false)
  const [graphStateRefreshing, setGraphStateRefreshing] = useState(false)
  const [goalsHistory, setGoalsHistory] = useState<ProjectGoal[] | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [editingKpi, setEditingKpi] = useState<string | null>(null)
  const [kpiDraft, setKpiDraft] = useState('')
  const [autoTrackingKpis, setAutoTrackingKpis] = useState(false)
  const [goalFormOpen, setGoalFormOpen] = useState(false)
  const [goalTitle, setGoalTitle] = useState('')
  const [goalDesc, setGoalDesc] = useState('')
  const [goalTargetDate, setGoalTargetDate] = useState('')
  const [goalCriteria, setGoalCriteria] = useState<SuccessCriteria[]>([])
  const [goalKpis, setGoalKpis] = useState<Array<{ metric: string; target: string; unit: string }>>([])
  const [savingGoal, setSavingGoal] = useState(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const autoVoiceRef = useRef(false)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const tokenQueueRef = useRef<string[]>([])
  const drainActiveRef = useRef(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const shouldAutoScrollRef = useRef(true)
  const submitMessageRef = useRef<(text: string) => void>(() => {})
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const projectSelectionInitializedRef = useRef(false)

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
    const saved = localStorage.getItem('rayzen_auto_voice')
    if (saved === 'true') {
      setAutoVoice(true)
      autoVoiceRef.current = true
    }
  }, [])

  useEffect(() => {
    autoVoiceRef.current = autoVoice
    localStorage.setItem('rayzen_auto_voice', autoVoice ? 'true' : 'false')
  }, [autoVoice])

  useEffect(() => {
    fetch(`${API_URL}/projects`, { headers: authHeaders() })
      .then((r) => r.json())
      .then((d) => setProjects(projectListFromResponse(d)))
      .catch(() => setProjects([]))
  }, [])

  useEffect(() => {
    if (projects.length === 0 || projectSelectionInitializedRef.current) return
    projectSelectionInitializedRef.current = true

    const savedProjectId = localStorage.getItem('rayzen_active_project_id')
    const savedProject = savedProjectId ? projects.find((project) => project.id === savedProjectId) : null
    const firstActiveProject = projects.find((project) => project.status === 'active') ?? projects[0]
    setActiveProjectId(savedProject?.id ?? firstActiveProject.id)
  }, [projects])

  useEffect(() => {
    if (activeProjectId) {
      localStorage.setItem('rayzen_active_project_id', activeProjectId)
    } else {
      localStorage.removeItem('rayzen_active_project_id')
    }
  }, [activeProjectId])

  useEffect(() => {
    setSessionId(crypto.randomUUID())
  }, [])

  useEffect(() => {
    if (!shouldAutoScrollRef.current) return
    bottomRef.current?.scrollIntoView({ behavior: 'auto' })
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
      if (memClass === 'global') {
        params.set('project_id', 'global')
      } else if (activeProjectId) {
        params.set('project_id', activeProjectId)
      }
      if (memClass !== 'all' && memClass !== 'global') params.set('memory_class', memClass)
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

  useEffect(() => {
    if (!activityOpen) return
    const id = setInterval(() => loadActivityEvents(memoryClassFilter), 5000)
    return () => clearInterval(id)
  }, [activityOpen, memoryClassFilter, loadActivityEvents])

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
      const slug = newProjectSlug.trim() || newProjectName.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
      const res = await fetch(`${API_URL}/projects`, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ name: newProjectName.trim(), description: newProjectDesc.trim() || undefined, repoSlug: slug }),
      })
      if (res.ok) {
        const data = await res.json()
        if (isProject(data)) {
          setProjects(prev => [...prev, data])
          setActiveProjectId(data.id)
          setOnboardProjectId(data.id)
          setOnboardStep(2)
        }
      }
    } catch { /* silencioso */ }
    finally { setCreatingProject(false) }
  }, [newProjectName, newProjectDesc, newProjectSlug])

  const closeNewProject = useCallback(() => {
    setNewProjectOpen(false)
    setNewProjectName('')
    setNewProjectDesc('')
    setNewProjectSlug('')
    setOnboardStep(1)
    setOnboardProjectId(null)
    setOnboardGoalTitle('')
    setOnboardGoalDate('')
    setOnboardGoalCriteria([''])
    setOnboardSrcTab('github')
  }, [])

  const onboardIndexSource = useCallback(async () => {
    if (!onboardProjectId) { setOnboardStep(3); return }
    setOnboardIndexing(true)
    try {
      if (onboardSrcTab === 'github' && githubUser.trim()) {
        const username = githubUser.trim().replace(/^https?:\/\/github\.com\//, '').replace(/\/$/, '')
        const res = await fetch(`${API_URL}/memory/index/github`, {
          method: 'POST',
          headers: authHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ username, repo: githubRepo.trim() || undefined, token: githubToken.trim() || undefined, projectId: onboardProjectId }),
        })
        if (!res.ok) console.warn('Onboard GitHub index:', await res.text())
      } else if (onboardSrcTab === 'notion' && notionToken.trim()) {
        const res = await fetch(`${API_URL}/memory/index/notion`, {
          method: 'POST',
          headers: authHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ integrationToken: notionToken.trim(), rootPageId: notionPageId.trim() || undefined, projectId: onboardProjectId }),
        })
        if (!res.ok) console.warn('Onboard Notion index:', await res.text())
      }
    } catch (err) {
      console.warn('Onboard index source falhou:', err)
    } finally {
      setOnboardIndexing(false)
      setOnboardStep(3)
    }
  }, [onboardProjectId, onboardSrcTab, githubUser, githubRepo, githubToken, notionPageId, notionToken])

  const onboardCreateGoal = useCallback(async () => {
    if (!onboardProjectId || !onboardGoalTitle.trim()) { closeNewProject(); return }
    setOnboardSavingGoal(true)
    try {
      const criteria = onboardGoalCriteria.filter(c => c.trim()).map((text, i) => ({ id: `c${i}`, text, done: false }))
      await fetch(`${API_URL}/projects/${onboardProjectId}/graph/goal`, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ title: onboardGoalTitle.trim(), successCriteria: criteria, targetDate: onboardGoalDate || undefined }),
      })
    } catch { /* silencioso */ }
    finally { setOnboardSavingGoal(false); closeNewProject() }
  }, [onboardProjectId, onboardGoalTitle, onboardGoalDate, onboardGoalCriteria, closeNewProject])

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
        body: JSON.stringify({
          username,
          repository: githubRepo.trim() || undefined,
          token: githubToken.trim() || undefined,
          projectId: activeProjectId ?? undefined,
        }),
      })
      if (!res.ok) {
        const err = await res.text()
        throw new Error(err || `HTTP ${res.status}`)
      }
      const data = await res.json() as { indexed: number; repos: number }
      setImportResult(`${data.repos} repositório${data.repos > 1 ? 's' : ''} indexado${data.repos > 1 ? 's' : ''} (${data.indexed} chunks)`)
    } catch (err) {
      setImportResult(`Erro: ${err instanceof Error ? err.message : 'falhou'}`)
    } finally {
      setImportLoading(false)
    }
  }, [githubUser, githubRepo, githubToken, activeProjectId])

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
  }, [activeProjectId])

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


  const refreshGraphState = useCallback(async () => {
    if (!activeProjectId) return
    setGraphStateRefreshing(true)
    try {
      await fetch(`${API_URL}/projects/${activeProjectId}/state/refresh`, { method: 'POST', headers: authHeaders() })
      const res = await fetch(`${API_URL}/projects/${activeProjectId}/graph`, { headers: authHeaders() })
      const data = res.ok ? await res.json() : null
      if (data?.state) setGraphStateData(data.state as ProjectState)
    } catch { /* ignore */ }
    setGraphStateRefreshing(false)
  }, [activeProjectId])

  const loadEventGraph = useCallback(async () => {
    if (!activeProjectId) return
    setGraphEventLoading(true)
    try {
      const res = await fetch(`${API_URL}/projects/${activeProjectId}/graph/events`, { headers: authHeaders() })
      if (res.ok) setGraphEventData(await res.json())
    } catch { /* ignore */ }
    setGraphEventLoading(false)
  }, [activeProjectId])

  const openGraph = useCallback(async (sub: 'estado' | 'goal' | 'eventos' = 'estado') => {
    if (!activeProjectId) return
    setGraphOpen(true)
    setGraphSubMode(sub)
    setGraphLoading(true)
    setGoalsHistory(null)
    setHistoryOpen(false)
    setGraphEventData(null)
    try {
      const [stateRes, goalRes] = await Promise.all([
        fetch(`${API_URL}/projects/${activeProjectId}/graph`, { headers: authHeaders() }),
        fetch(`${API_URL}/projects/${activeProjectId}/graph/goal`, { headers: authHeaders() }),
      ])
      const stateData = stateRes.ok ? await stateRes.json() : null
      const goalData = goalRes.ok ? await goalRes.json() : null
      if (stateData?.state) setGraphStateData(stateData.state as ProjectState)
      if (goalData?.mermaid) setGraphGoalData(goalData as GoalGraphData)
    } catch { /* ignore */ }
    setGraphLoading(false)
  }, [activeProjectId])

  const saveGoal = useCallback(async () => {
    if (!activeProjectId || !goalTitle.trim()) return
    setSavingGoal(true)
    try {
      const res = await fetch(`${API_URL}/projects/${activeProjectId}/graph/goal`, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ title: goalTitle, description: goalDesc || undefined, successCriteria: goalCriteria, kpis: goalKpis, targetDate: goalTargetDate || undefined }),
      })
      if (res.ok) {
        setGoalFormOpen(false); setGoalTitle(''); setGoalDesc(''); setGoalTargetDate(''); setGoalCriteria([]); setGoalKpis([])
        openGraph('goal')
      }
    } catch { /* ignore */ }
    setSavingGoal(false)
  }, [activeProjectId, goalTitle, goalDesc, goalTargetDate, goalCriteria, goalKpis, openGraph])

  const toggleCriteria = useCallback(async (goalId: string, criteriaId: string, done: boolean) => {
    await fetch(`${API_URL}/projects/${activeProjectId}/graph/goal/${goalId}/criteria/${criteriaId}`, {
      method: 'PATCH',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ done }),
    }).catch(() => null)
    openGraph('goal')
  }, [activeProjectId, openGraph])

  const loadGoalsHistory = useCallback(async () => {
    if (!activeProjectId) return
    setHistoryLoading(true)
    try {
      const res = await fetch(`${API_URL}/projects/${activeProjectId}/graph/goals`, { headers: authHeaders() })
      if (res.ok) setGoalsHistory(await res.json() as ProjectGoal[])
    } catch { /* silencioso */ }
    finally { setHistoryLoading(false) }
  }, [activeProjectId])

  const toggleHistory = useCallback(async () => {
    if (!historyOpen && !goalsHistory) await loadGoalsHistory()
    setHistoryOpen(v => !v)
  }, [historyOpen, goalsHistory, loadGoalsHistory])

  const achieveGoal = useCallback(async (goalId: string) => {
    if (!activeProjectId) return
    if (!confirm('Marcar esta meta como conquistada? Ela será arquivada e você poderá criar uma nova.')) return
    await fetch(`${API_URL}/projects/${activeProjectId}/graph/goal/${goalId}/status`, {
      method: 'PATCH',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ status: 'achieved' }),
    }).catch(() => null)
    setGoalsHistory(null)
    openGraph('goal')
  }, [activeProjectId, openGraph])

  const saveKpi = useCallback(async (goalId: string, metric: string) => {
    if (!activeProjectId) return
    await fetch(`${API_URL}/projects/${activeProjectId}/graph/goal/${goalId}/kpi`, {
      method: 'PATCH',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ metric, current: kpiDraft }),
    }).catch(() => null)
    setEditingKpi(null)
    openGraph('goal')
  }, [activeProjectId, kpiDraft, openGraph])

  const saveCriteria = useCallback(async (goalId: string, criteria: SuccessCriteria[]) => {
    if (!activeProjectId) return
    await fetch(`${API_URL}/projects/${activeProjectId}/graph/goal/${goalId}/criteria`, {
      method: 'PATCH',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ criteria }),
    }).catch(() => null)
    openGraph('goal')
  }, [activeProjectId, openGraph])

  const autoTrackKpis = useCallback(async (goalId: string) => {
    if (!activeProjectId) return
    setAutoTrackingKpis(true)
    await fetch(`${API_URL}/projects/${activeProjectId}/graph/goal/${goalId}/kpi/auto-track`, {
      method: 'POST',
      headers: authHeaders(),
    }).catch(() => null)
    setAutoTrackingKpis(false)
    openGraph('goal')
  }, [activeProjectId, openGraph])

  const openMemoryPanel = useCallback(async () => {
    setMemoryOpen(true)
    setMemorySearch('')
    setMemorySearchResults(null)
    setMemoryDocsLoading(true)
    try {
      const url = activeProjectId
        ? `${API_URL}/memory/documents?projectId=${activeProjectId}`
        : `${API_URL}/memory/documents`
      const res = await fetch(url, { headers: authHeaders() })
      const data = await res.json() as MemoryDoc[]
      setMemoryDocs(data)
    } catch { /* silencioso */ }
    finally { setMemoryDocsLoading(false) }
  }, [activeProjectId])

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

  const playAudio = useCallback(async (text: string, index: number, force = false) => {
    if (!force && playingIndex === index) {
      audioRef.current?.pause()
      setPlayingIndex(null)
      return
    }

    const spokenText = text
      .replace(/\n?\[DOC_PENDING:[A-Za-z0-9+/=]*\]/g, '')
      .replace(/\n?\[ACTION_PENDING:[A-Za-z0-9+/=]*\]/g, '')
      .trim()
    if (!spokenText) return

    setPlayingIndex(index)
    try {
      const res = await fetch(`${API_URL}/voice/synthesize`, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ text: spokenText }),
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
    shouldAutoScrollRef.current = true
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
      let assistantText = ''

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
            assistantText += data.text as string
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

          if (typeof data.message === 'string' && !data.text) {
            setMessages((prev) => {
              const updated = [...prev]
              updated[updated.length - 1] = { ...updated[updated.length - 1], content: `Erro: ${data.message as string}` }
              return updated
            })
          }
        }
      }
      if (autoVoiceRef.current && assistantText.trim()) {
        setTimeout(() => {
          setMessages((prev) => {
            const index = prev.length - 1
            const last = prev[index]
            if (last?.role === 'assistant') void playAudio(last.content || assistantText, index, true)
            return prev
          })
        }, 250)
      }
    } catch (err) {
      const errMsg = `Erro: ${err instanceof Error ? err.message : 'desconhecido'}`
      setMessages((prev) => {
        const updated = [...prev]
        const last = updated[updated.length - 1]
        if (last?.role === 'assistant' && !last.content) {
          updated[updated.length - 1] = { ...last, content: errMsg }
          return updated
        }
        return [...prev, { role: 'assistant', content: errMsg }]
      })
    } finally {
      setLoading(false)
    }
  }, [loading, sessionId, drainQueue])

  useEffect(() => {
    submitMessageRef.current = sendMessage
  }, [sendMessage])

  useEffect(() => {
    if (!loading) inputRef.current?.focus()
  }, [loading])

  function submitCurrentInput() {
    const message = input.trim()
    if (!message || loading) return
    sendMessage(message)
    requestAnimationFrame(() => inputRef.current?.focus())
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    submitCurrentInput()
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
    <main className="h-screen overflow-hidden bg-zinc-950 text-zinc-100 flex flex-col">

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

      {/* New project wizard */}
      {newProjectOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="fixed inset-0 bg-black/70" onClick={onboardStep === 1 ? closeNewProject : undefined} />
          <div className="relative z-50 w-full max-w-sm bg-zinc-900 border border-zinc-800 rounded-2xl p-5 mx-4">

            {/* Header */}
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold">
                {onboardStep === 1 ? 'Novo projeto' : onboardStep === 2 ? 'Indexar fonte de conhecimento' : 'Primeira meta'}
              </h2>
              <button onClick={closeNewProject} className="text-zinc-500 hover:text-zinc-300 text-xl leading-none">×</button>
            </div>

            {/* Step bar */}
            <div className="flex gap-1.5 mb-4">
              {([1, 2, 3] as const).map(s => (
                <div key={s} className={`h-0.5 flex-1 rounded-full transition-colors ${onboardStep >= s ? 'bg-zinc-100' : 'bg-zinc-700'}`} />
              ))}
            </div>

            {/* Step 1 — project info */}
            {onboardStep === 1 && (
              <div className="space-y-3">
                <div>
                  <label className="text-xs text-zinc-500 mb-1 block">Nome *</label>
                  <input
                    value={newProjectName}
                    onChange={(e) => {
                      setNewProjectName(e.target.value)
                      if (!newProjectSlug) setNewProjectSlug(e.target.value.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, ''))
                    }}
                    onKeyDown={(e) => { if (e.key === 'Enter') createProject() }}
                    placeholder="ex: Rayzen PDV"
                    autoFocus
                    className="w-full bg-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 outline-none focus:ring-1 focus:ring-zinc-600"
                  />
                </div>
                <div>
                  <label className="text-xs text-zinc-500 mb-1 block">
                    Pasta / repo slug
                    <span className="text-zinc-600 ml-1">— deve bater com o nome da pasta no VS Code</span>
                  </label>
                  <input
                    value={newProjectSlug}
                    onChange={(e) => setNewProjectSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                    placeholder="ex: rayzen-pdv"
                    className="w-full bg-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 outline-none focus:ring-1 focus:ring-zinc-600 font-mono"
                  />
                  <p className="text-[10px] text-zinc-600 mt-1">O hook do Claude detecta automaticamente o projeto por este nome</p>
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
                  {creatingProject ? 'Criando…' : 'Criar e continuar →'}
                </button>
              </div>
            )}

            {/* Step 2 — source indexing */}
            {onboardStep === 2 && (
              <div className="space-y-3">
                <p className="text-xs text-zinc-400">Indexe o repositório ou docs para o Brain entender o contexto do projeto.</p>
                <div className="flex gap-1">
                  {(['github', 'notion', 'skip'] as const).map(tab => (
                    <button key={tab} onClick={() => setOnboardSrcTab(tab)}
                      className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition-colors ${onboardSrcTab === tab ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'}`}>
                      {tab === 'github' ? 'GitHub' : tab === 'notion' ? 'Notion' : 'Pular'}
                    </button>
                  ))}
                </div>

                {onboardSrcTab === 'github' && (
                  <div className="space-y-2">
                    <input value={githubUser} onChange={e => setGithubUser(e.target.value)} placeholder="usuário ou org (ex: marcelorayzen)"
                      className="w-full bg-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 outline-none focus:ring-1 focus:ring-zinc-600" />
                    <input value={githubRepo} onChange={e => setGithubRepo(e.target.value)} placeholder="repositório (opcional — indexa todos se vazio)"
                      className="w-full bg-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 outline-none focus:ring-1 focus:ring-zinc-600" />
                    <input value={githubToken} onChange={e => setGithubToken(e.target.value)} placeholder="token GitHub (opcional, para repos privados)" type="password"
                      className="w-full bg-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 outline-none focus:ring-1 focus:ring-zinc-600" />
                  </div>
                )}

                {onboardSrcTab === 'notion' && (
                  <div className="space-y-2">
                    <input value={notionToken} onChange={e => setNotionToken(e.target.value)} placeholder="Integration token (secret_...) *" type="password"
                      className="w-full bg-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 outline-none focus:ring-1 focus:ring-zinc-600" />
                    <input value={notionPageId} onChange={e => setNotionPageId(e.target.value)} placeholder="ID ou URL da página (opcional)"
                      className="w-full bg-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 outline-none focus:ring-1 focus:ring-zinc-600" />
                  </div>
                )}

                {onboardSrcTab === 'skip' && (
                  <p className="text-xs text-zinc-500">Você pode indexar fontes depois no painel Brain.</p>
                )}

                <button
                  onClick={onboardSrcTab === 'skip' ? () => setOnboardStep(3) : onboardIndexSource}
                  disabled={
                    onboardIndexing ||
                    (onboardSrcTab === 'github' && !githubUser.trim()) ||
                    (onboardSrcTab === 'notion' && !notionToken.trim())
                  }
                  className="w-full bg-zinc-700 hover:bg-zinc-600 text-zinc-100 rounded-lg py-2 text-sm font-medium disabled:opacity-40 transition-colors"
                >
                  {onboardIndexing ? 'Indexando…' : onboardSrcTab === 'skip' ? 'Pular →' : 'Indexar e continuar →'}
                </button>
              </div>
            )}

            {/* Step 3 — first goal */}
            {onboardStep === 3 && (
              <div className="space-y-3">
                <p className="text-xs text-zinc-400">Defina onde este projeto quer chegar. O Rayzen usará isso para orientar o Gap Analysis.</p>
                <div>
                  <label className="text-xs text-zinc-500 mb-1 block">Título da meta *</label>
                  <input value={onboardGoalTitle} onChange={e => setOnboardGoalTitle(e.target.value)}
                    placeholder="ex: Lançar MVP com 50 usuários ativos"
                    autoFocus
                    className="w-full bg-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 outline-none focus:ring-1 focus:ring-zinc-600" />
                </div>
                <div>
                  <label className="text-xs text-zinc-500 mb-1 block">Prazo (opcional)</label>
                  <input type="date" value={onboardGoalDate} onChange={e => setOnboardGoalDate(e.target.value)}
                    className="w-full bg-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100 outline-none focus:ring-1 focus:ring-zinc-600" />
                </div>
                <div>
                  <label className="text-xs text-zinc-500 mb-1 block">Critérios de sucesso</label>
                  <div className="space-y-1.5">
                    {onboardGoalCriteria.map((c, i) => (
                      <div key={i} className="flex gap-1.5">
                        <input value={c} onChange={e => setOnboardGoalCriteria(p => p.map((x, j) => j === i ? e.target.value : x))}
                          placeholder={`Critério ${i + 1}`}
                          onKeyDown={e => { if (e.key === 'Enter' && i === onboardGoalCriteria.length - 1) setOnboardGoalCriteria(p => [...p, '']) }}
                          className="flex-1 bg-zinc-800 rounded-lg px-3 py-1.5 text-sm text-zinc-100 placeholder:text-zinc-600 outline-none focus:ring-1 focus:ring-zinc-600" />
                        {onboardGoalCriteria.length > 1 && (
                          <button onClick={() => setOnboardGoalCriteria(p => p.filter((_, j) => j !== i))}
                            className="text-zinc-600 hover:text-zinc-400 text-lg leading-none px-1">×</button>
                        )}
                      </div>
                    ))}
                    <button onClick={() => setOnboardGoalCriteria(p => [...p, ''])}
                      className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors">+ critério</button>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button onClick={closeNewProject}
                    className="flex-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 rounded-lg py-2 text-sm font-medium transition-colors">
                    Pular
                  </button>
                  <button onClick={onboardCreateGoal} disabled={onboardSavingGoal || !onboardGoalTitle.trim()}
                    className="flex-1 bg-zinc-100 text-zinc-900 rounded-lg py-2 text-sm font-medium disabled:opacity-40 hover:bg-white transition-colors">
                    {onboardSavingGoal ? 'Salvando…' : 'Concluir'}
                  </button>
                </div>
              </div>
            )}

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
            <div className="flex gap-1 mb-3 flex-wrap">
              {(['all', 'global', 'consolidated', 'working', 'inbox', 'archive'] as MemoryClassFilter[]).map((cls) => (
                <button
                  key={cls}
                  onClick={() => { setMemoryClassFilter(cls); loadActivityEvents(cls) }}
                  className={`text-[10px] px-2 py-1 rounded-lg font-medium transition-colors ${
                    memoryClassFilter === cls
                      ? cls === 'consolidated' ? 'bg-emerald-700 text-white'
                        : cls === 'working'    ? 'bg-amber-700 text-white'
                        : cls === 'archive'    ? 'bg-zinc-600 text-zinc-300'
                        : cls === 'inbox'      ? 'bg-indigo-700 text-white'
                        : cls === 'global'     ? 'bg-sky-700 text-white'
                        : 'bg-zinc-700 text-zinc-200'
                      : 'bg-zinc-800 text-zinc-500 hover:text-zinc-300'
                  }`}
                >
                  {cls}
                </button>
              ))}
            </div>
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
                        {ev.project
                          ? <span className="text-[9px] px-1.5 py-0.5 rounded bg-sky-900 text-sky-300 font-medium">{ev.project.name}</span>
                          : <span className="text-[9px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-500 font-medium">global</span>
                        }
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
                <p className="text-zinc-500 text-xs text-center py-4">Nenhuma síntese ainda. Clique em &quot;Sintetizar sessão atual&quot; para começar.</p>
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
                <h2 className="text-sm font-semibold text-zinc-200">
                  {activeProjectId ? `Memória — ${projects.find(p => p.id === activeProjectId)?.name ?? 'Projeto'}` : 'Memória indexada'}
                </h2>
                {!memoryDocsLoading && (
                  <p className="text-xs text-zinc-500 mt-0.5">
                    {memoryDocs.length} chunks
                    {!activeProjectId && ' · todos os projetos'}
                  </p>
                )}
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

            {/* List filter */}
            {memorySearchResults === null && (
              <div className="mb-4">
                <input
                  value={memoryListFilter}
                  onChange={(e) => setMemoryListFilter(e.target.value)}
                  placeholder="Filtrar origens indexadas..."
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-zinc-100 placeholder:text-zinc-600 outline-none focus:ring-1 focus:ring-zinc-600"
                />
              </div>
            )}

            {/* Results */}
            <div className="overflow-y-auto flex-1 space-y-2 pr-1">
              {memoryDocsLoading && <p className="text-xs text-zinc-500 text-center py-8">Carregando…</p>}

              {/* Search results */}
              {memorySearchResults !== null && !memorySearching && (
                <>
                  {memorySearchResults.length === 0 && (
                    <p className="text-xs text-zinc-500 text-center py-8">Nenhum resultado encontrado</p>
                  )}
                  {memorySearchResults.map((r) => {
                    const dtype = memoryDocType(r.sourcePath, null)
                    const fileName = r.sourcePath ? r.sourcePath.split('/').pop() ?? r.sourcePath : 'sem origem'
                    return (
                      <div key={r.id} className="bg-zinc-800 rounded-xl p-3">
                        <div className="flex items-center justify-between mb-1.5">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className={`shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded-md ${DOC_TYPE_COLORS[dtype]}`}>
                              {DOC_TYPE_LABELS[dtype]}
                            </span>
                            <span className="text-[11px] text-zinc-500 truncate" title={r.sourcePath ?? ''}>{fileName}</span>
                          </div>
                          <span className="text-[11px] text-zinc-600 ml-2 shrink-0">{(r.score * 100).toFixed(0)}%</span>
                        </div>
                        <p className="text-xs text-zinc-300 line-clamp-3">{r.content}</p>
                      </div>
                    )
                  })}
                </>
              )}

              {/* Document list */}
              {memorySearchResults === null && !memoryDocsLoading && (() => {
                const projectColorMap = new Map<string, string>()
                projects.forEach((p, i) => projectColorMap.set(p.id, PROJECT_COLORS[i % PROJECT_COLORS.length]))

                const groups = memoryDocs.reduce<Record<string, {
                  ids: string[]; count: number; label: string; lastIndexedAt: string
                  docType: MemoryDocType; projectId: string | null; sourcePath: string | null
                }>>((acc, d) => {
                  const group = memoryGroupFor(d)
                  const key = group.key
                  const indexedAt = d.createdAt
                  if (!acc[key]) acc[key] = {
                    ids: [], count: 0, label: group.label, lastIndexedAt: indexedAt,
                    docType: memoryDocType(d.sourcePath, d.metadata),
                    projectId: d.projectId ?? null,
                    sourcePath: d.sourcePath,
                  }
                  acc[key].ids.push(d.id)
                  acc[key].count++
                  if (new Date(indexedAt).getTime() > new Date(acc[key].lastIndexedAt).getTime()) {
                    acc[key].lastIndexedAt = indexedAt
                  }
                  return acc
                }, {})

                const filter = memoryListFilter.trim().toLowerCase()
                const entries = Object.entries(groups)
                  .filter(([source, group]) => !filter || source.toLowerCase().includes(filter) || group.label.toLowerCase().includes(filter))
                  .sort((a, b) => new Date(b[1].lastIndexedAt).getTime() - new Date(a[1].lastIndexedAt).getTime())

                if (entries.length === 0) {
                  return <p className="text-xs text-zinc-500 text-center py-8">Nenhuma origem encontrada</p>
                }

                return entries.map(([source, { ids, count, label, lastIndexedAt, docType, projectId, sourcePath }]) => {
                  const project = projectId ? projects.find(p => p.id === projectId) : null
                  const projectColor = projectId ? (projectColorMap.get(projectId) ?? PROJECT_COLORS[0]) : null
                  const norm = (sourcePath ?? '').replace(/\\/g, '/')
                  const fileName = norm ? (norm.split('/').pop() ?? label) : label
                  const inferredProject = !project ? projectLabelFromPath(sourcePath) : null
                  const relDir = relativePathFromFull(sourcePath)
                  const displayPath = relDir ?? (norm.length > 60 ? '…' + norm.slice(-55) : norm)

                  return (
                    <div key={source} className="bg-zinc-800 rounded-xl px-3 py-2.5 group">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          {/* Linha 1: badges tipo + projeto */}
                          <div className="flex items-center gap-1.5 mb-1.5 flex-wrap">
                            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${DOC_TYPE_COLORS[docType]}`}>
                              {DOC_TYPE_LABELS[docType]}
                            </span>
                            {project ? (
                              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${projectColor}`}>
                                {project.name}
                              </span>
                            ) : inferredProject ? (
                              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-zinc-600/50 text-zinc-300">
                                {inferredProject}
                              </span>
                            ) : null}
                          </div>
                          {/* Linha 2: nome do arquivo em destaque */}
                          <span className="block text-sm text-zinc-100 font-semibold truncate" title={sourcePath ?? label}>
                            {fileName}
                          </span>
                          {/* Linha 3: caminho relativo */}
                          <span className="block text-[11px] text-zinc-500 truncate mt-0.5" title={norm || source}>
                            {displayPath}
                          </span>
                          {/* Linha 4: timestamp */}
                          <span className="block text-[10px] text-zinc-600 mt-0.5">
                            {new Date(lastIndexedAt).toLocaleString('pt-BR')}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 shrink-0 mt-0.5">
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
                    </div>
                  )
                })
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
                  <label className="text-xs text-zinc-500 mb-1 block">Repositório (opcional)</label>
                  <input
                    value={githubRepo}
                    onChange={(e) => setGithubRepo(e.target.value)}
                    placeholder="ex: rayzen-ai"
                    className="w-full bg-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 outline-none focus:ring-1 focus:ring-zinc-600"
                  />
                  <p className="text-[11px] text-zinc-600 mt-1">Preencha para indexar só este repo; vazio indexa todos.</p>
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
      <div className="shrink-0 sticky top-0 z-30 bg-zinc-950/95 backdrop-blur border-b border-zinc-800 px-6 py-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
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
        <div className="flex items-center gap-3 flex-wrap justify-end min-w-0">
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
          {activeProjectId && (
            <button
              onClick={() => openGraph('goal')}
              className="text-zinc-500 hover:text-zinc-300 transition-colors text-xs"
              title="Goal Graph — meta vs estado atual"
            >
              grafo
            </button>
          )}
          <button
            onClick={() => setAutoVoice((v) => !v)}
            className={`text-xs transition-colors ${
              autoVoice ? 'text-emerald-400 hover:text-emerald-300' : 'text-zinc-500 hover:text-zinc-300'
            }`}
            title="Ler respostas do assistente em voz alta automaticamente"
          >
            voz auto {autoVoice ? 'on' : 'off'}
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
      <div
        ref={messagesContainerRef}
        onScroll={() => {
          const el = messagesContainerRef.current
          if (!el) return
          shouldAutoScrollRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 160
        }}
        className="flex-1 min-h-0 overflow-y-auto px-4 py-6 flex flex-col gap-4 max-w-3xl w-full mx-auto"
      >
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
                    {msg.content
                      .replace(/\n?\[DOC_PENDING:[A-Za-z0-9+/=]*\]/g, '')
                      .replace(/\n?\[ACTION_PENDING:[A-Za-z0-9+/=]*\]/g, '')
                      .trim()}
                  </ReactMarkdown>
                </div>
              ) : (
                msg.content
              )}

              {msg.role === 'assistant' && (
                <div className="mt-2 flex items-center gap-3">
                  {msg.content.includes('[ACTION_PENDING:') && (
                    <>
                      <button
                        onClick={() => sendMessage('confirmar')}
                        disabled={loading}
                        className="text-xs bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white px-2 py-1 rounded-md transition-colors"
                      >
                        Confirmar
                      </button>
                      <button
                        onClick={() => sendMessage('cancelar')}
                        disabled={loading}
                        className="text-xs bg-zinc-700 hover:bg-zinc-600 disabled:opacity-40 text-zinc-200 px-2 py-1 rounded-md transition-colors"
                      >
                        Cancelar
                      </button>
                    </>
                  )}
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
      <div className="shrink-0 border-t border-zinc-800 bg-zinc-950 px-4 py-4">
        <form onSubmit={handleSubmit} className="flex gap-2 max-w-3xl mx-auto">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                submitCurrentInput()
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
      {/* Goal Graph panel */}
      {graphOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="fixed inset-0 bg-black/70" onClick={() => setGraphOpen(false)} />
          <div className="relative bg-zinc-900 border border-zinc-700 rounded-2xl w-full max-w-3xl max-h-[90vh] flex flex-col shadow-2xl mx-4">
            <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
              <div className="flex items-center gap-4">
                <span className="text-sm font-semibold text-zinc-200">Goal Graph</span>
                <div className="flex gap-1">
                  {(['estado', 'goal', 'eventos'] as const).map(m => (
                    <button key={m} onClick={() => {
                      setGraphSubMode(m)
                      if (m === 'eventos' && !graphEventData) loadEventGraph()
                    }}
                      className={`px-3 py-1 rounded-full text-xs transition-colors ${graphSubMode === m ? 'bg-zinc-700 text-zinc-200' : 'text-zinc-500 hover:text-zinc-300'}`}>
                      {m === 'goal' ? 'Goal Graph' : m === 'eventos' ? 'Eventos' : 'Estado atual'}
                    </button>
                  ))}
                </div>
              </div>
              <button onClick={() => setGraphOpen(false)} className="text-zinc-500 hover:text-zinc-300 text-lg leading-none">×</button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
              {graphLoading ? (
                <div className="text-zinc-500 text-sm text-center py-8">Carregando…</div>
              ) : graphSubMode === 'eventos' ? (
                <>
                  <p className="text-xs text-zinc-500 mb-2">Eventos recentes conectados aos milestones do projeto via LLM.</p>
                  {graphEventLoading ? (
                    <div className="text-zinc-500 text-sm text-center py-8">Mapeando eventos…</div>
                  ) : graphEventData ? (
                    <div className="rounded-xl overflow-hidden border border-zinc-800">
                      <GraphCanvas mode="eventos" milestones={graphEventData.milestones} events={graphEventData.events} />
                    </div>
                  ) : (
                    <div className="text-center py-8">
                      <button onClick={loadEventGraph} className="text-xs text-blue-400 hover:text-blue-300 transition-colors">⟳ carregar event graph</button>
                    </div>
                  )}
                </>
              ) : graphSubMode === 'estado' ? (
                <>
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-xs text-zinc-500">Milestones, blockers e próximos passos do projeto.</p>
                    <button
                      onClick={refreshGraphState}
                      disabled={graphStateRefreshing}
                      className="text-xs text-blue-400 hover:text-blue-300 disabled:opacity-40 transition-colors shrink-0"
                    >
                      {graphStateRefreshing ? 'Analisando…' : '⟳ gerar estado'}
                    </button>
                  </div>
                  <div className="rounded-xl overflow-hidden border border-zinc-800">
                    <GraphCanvas
                      mode="estado"
                      milestones={graphStateData?.milestones ?? []}
                      blockers={graphStateData?.blockers ?? []}
                      nextSteps={graphStateData?.nextSteps ?? []}
                      onSave={async (patch) => {
                        await fetch(`${API_URL}/projects/${activeProjectId}/state/planning`, {
                          method: 'PATCH',
                          headers: authHeaders({ 'Content-Type': 'application/json' }),
                          body: JSON.stringify(patch),
                        }).catch(() => null)
                      }}
                    />
                  </div>
                </>
              ) : graphGoalData ? (
                <>
                  {graphGoalData.goal ? (
                    <>
                      {/* Goal card */}
                      <div className="bg-zinc-800 rounded-xl p-4 space-y-2">
                        <div className="flex items-start justify-between gap-2">
                          <span className="text-sm font-semibold text-zinc-200 leading-snug">🎯 {graphGoalData.goal.title}</span>
                          <div className="flex items-center gap-2 shrink-0">
                            {graphGoalData.goal.targetDate && (
                              <span className="text-xs text-zinc-500">{new Date(graphGoalData.goal.targetDate).toLocaleDateString('pt-BR')}</span>
                            )}
                            <button
                              onClick={() => achieveGoal(graphGoalData.goal!.id)}
                              title="Marcar como conquistada"
                              className="text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20 transition-colors"
                            >
                              conquistar
                            </button>
                          </div>
                        </div>
                        {graphGoalData.goal.description && (
                          <p className="text-xs text-zinc-400">{graphGoalData.goal.description}</p>
                        )}
                        {/* Progress bar */}
                        {graphGoalData.gapAnalysis && (
                          <div>
                            <div className="flex justify-between text-xs text-zinc-500 mb-1">
                              <span>Progresso</span>
                              <span>{graphGoalData.gapAnalysis.goalProgress}%</span>
                            </div>
                            <div className="h-1.5 bg-zinc-700 rounded-full overflow-hidden">
                              <div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: `${graphGoalData.gapAnalysis.goalProgress}%` }} />
                            </div>
                          </div>
                        )}
                        {/* Criteria */}
                        {graphGoalData.goal.successCriteria.length > 0 && (
                          <div className="space-y-1 pt-1">
                            {graphGoalData.goal.successCriteria.map(c => (
                              <button key={c.id} onClick={() => toggleCriteria(graphGoalData.goal!.id, c.id, !c.done)}
                                className="flex items-center gap-2 w-full text-left text-xs text-zinc-400 hover:text-zinc-200 transition-colors">
                                <span className={c.done ? 'text-emerald-400' : 'text-zinc-600'}>{c.done ? '✅' : '⬜'}</span>
                                <span className={c.done ? 'line-through text-zinc-600' : ''}>{c.text}</span>
                              </button>
                            ))}
                          </div>
                        )}

                        {/* KPIs */}
                        {graphGoalData.goal.kpis.length > 0 && (
                          <div className="pt-2 border-t border-zinc-700 space-y-2">
                            <div className="flex items-center justify-between">
                              <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">KPIs</p>
                              <button
                                onClick={() => autoTrackKpis(graphGoalData.goal!.id)}
                                disabled={autoTrackingKpis}
                                className="text-[10px] text-zinc-500 hover:text-zinc-300 disabled:opacity-40 transition-colors"
                                title="LLM analisa eventos recentes e estima os valores atuais"
                              >
                                {autoTrackingKpis ? 'analisando…' : '⟳ auto-detectar'}
                              </button>
                            </div>
                            {graphGoalData.goal.kpis.map(k => {
                              const cur = parseFloat(k.current ?? '')
                              const tgt = parseFloat(k.target)
                              const pct = !isNaN(cur) && !isNaN(tgt) && tgt > 0 ? Math.min(100, Math.round((cur / tgt) * 100)) : null
                              const isEditing = editingKpi === k.metric
                              return (
                                <div key={k.metric}>
                                  <div className="flex items-center justify-between text-xs mb-1">
                                    <span className="text-zinc-400">{k.metric}</span>
                                    <div className="flex items-center gap-1.5">
                                      {isEditing ? (
                                        <>
                                          <input
                                            autoFocus
                                            value={kpiDraft}
                                            onChange={e => setKpiDraft(e.target.value)}
                                            onKeyDown={e => {
                                              if (e.key === 'Enter') saveKpi(graphGoalData.goal!.id, k.metric)
                                              if (e.key === 'Escape') setEditingKpi(null)
                                            }}
                                            onBlur={() => saveKpi(graphGoalData.goal!.id, k.metric)}
                                            placeholder={k.current ?? '0'}
                                            className="w-16 bg-zinc-700 rounded px-1.5 py-0.5 text-xs text-zinc-100 outline-none focus:ring-1 focus:ring-blue-500 text-right"
                                          />
                                          <span className="text-zinc-500">/ {k.target} {k.unit}</span>
                                        </>
                                      ) : (
                                        <button
                                          onClick={() => { setEditingKpi(k.metric); setKpiDraft(k.current ?? '') }}
                                          className="text-zinc-400 hover:text-zinc-200 transition-colors tabular-nums"
                                          title="Clique para atualizar"
                                        >
                                          {k.current ?? '—'} / {k.target} {k.unit}
                                        </button>
                                      )}
                                    </div>
                                  </div>
                                  {pct !== null && (
                                    <div className="h-1 bg-zinc-700 rounded-full overflow-hidden">
                                      <div className={`h-full rounded-full transition-all ${pct >= 100 ? 'bg-emerald-500' : pct >= 60 ? 'bg-blue-500' : 'bg-amber-500'}`}
                                        style={{ width: `${pct}%` }} />
                                    </div>
                                  )}
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </div>

                      {/* Gap Analysis */}
                      {graphGoalData.gapAnalysis && (
                        <>
                          {/* Next Best Action */}
                          <div className="bg-blue-500/10 border border-blue-500/30 rounded-xl px-4 py-3">
                            <p className="text-xs text-blue-300 font-medium mb-0.5">▶ Next Best Action</p>
                            <p className="text-sm text-blue-100">{graphGoalData.gapAnalysis.nextBestAction}</p>
                          </div>
                          {/* Gaps */}
                          {graphGoalData.gapAnalysis.gaps.length > 0 && (
                            <div className="space-y-2">
                              <p className="text-xs text-zinc-500 font-medium uppercase tracking-wide">Gaps identificados</p>
                              {graphGoalData.gapAnalysis.gaps.map((g, i) => (
                                <div key={i} className={`rounded-xl px-4 py-3 border ${
                                  g.severity === 'high' ? 'bg-red-500/10 border-red-500/30' :
                                  g.severity === 'medium' ? 'bg-amber-500/10 border-amber-500/30' :
                                  'bg-zinc-800 border-zinc-700'
                                }`}>
                                  <div className="flex items-center gap-2 mb-0.5">
                                    <span className={`text-[10px] uppercase font-bold px-1.5 py-0.5 rounded ${
                                      g.severity === 'high' ? 'bg-red-500/20 text-red-400' :
                                      g.severity === 'medium' ? 'bg-amber-500/20 text-amber-400' :
                                      'bg-zinc-700 text-zinc-400'
                                    }`}>{g.severity}</span>
                                    <span className="text-xs text-zinc-500">{g.area}</span>
                                  </div>
                                  <p className="text-xs text-zinc-300">{g.description}</p>
                                  {g.relatedCriteria && <p className="text-[10px] text-zinc-500 mt-0.5">Critério: {g.relatedCriteria}</p>}
                                </div>
                              ))}
                            </div>
                          )}
                        </>
                      )}

                      {/* React Flow diagram */}
                      <div>
                        <p className="text-xs text-zinc-500 font-medium uppercase tracking-wide mb-2">Diagrama</p>
                        <div className="bg-zinc-900 rounded-xl overflow-hidden border border-zinc-800">
                          <GraphCanvas
                            mode="goal"
                            goalTitle={graphGoalData.goal.title}
                            targetDate={graphGoalData.goal.targetDate}
                            criteria={graphGoalData.goal.successCriteria}
                            gaps={graphGoalData.gapAnalysis?.gaps ?? []}
                            nextBestAction={graphGoalData.gapAnalysis?.nextBestAction}
                            goalProgress={graphGoalData.gapAnalysis?.goalProgress}
                            goalId={graphGoalData.goal.id}
                            onToggleCriteria={(cid, done) => toggleCriteria(graphGoalData.goal!.id, cid, done)}
                            onSaveCriteria={(c) => saveCriteria(graphGoalData.goal!.id, c)}
                          />
                        </div>
                      </div>

                      {/* Goal history */}
                      <div className="border-t border-zinc-800 pt-3">
                        <button onClick={toggleHistory}
                          className="flex items-center gap-2 text-xs text-zinc-500 hover:text-zinc-300 transition-colors w-full text-left">
                          <span className="text-[10px]">{historyOpen ? '▲' : '▼'}</span>
                          histórico de metas
                          {historyLoading && <span className="text-zinc-600">carregando…</span>}
                          {goalsHistory && !historyLoading && (
                            <span className="text-zinc-600">({goalsHistory.length})</span>
                          )}
                        </button>
                        {historyOpen && goalsHistory && (
                          <div className="mt-2 space-y-2">
                            {goalsHistory.filter(g => g.status !== 'cancelled').map(g => {
                              const total = g.successCriteria.length
                              const done = g.successCriteria.filter(c => c.done).length
                              const pct = total > 0 ? Math.round((done / total) * 100) : null
                              const isActive = g.id === graphGoalData!.goal!.id
                              return (
                                <GoalHistoryCard key={g.id} g={g} isActive={isActive} total={total} done={done} pct={pct} />
                              )
                            })}
                          </div>
                        )}
                      </div>
                    </>
                  ) : (
                    /* No goal yet — show form trigger */
                    <div className="text-center py-8 space-y-3">
                      <p className="text-zinc-400 text-sm">Nenhuma meta definida para este projeto.</p>
                      <button onClick={() => setGoalFormOpen(true)}
                        className="bg-blue-600 hover:bg-blue-500 text-white text-sm px-4 py-2 rounded-lg transition-colors">
                        Definir meta
                      </button>
                    </div>
                  )}
                </>
              ) : null}
            </div>

            {/* Footer: refresh + define goal */}
            <div className="border-t border-zinc-800 px-6 py-3 flex items-center justify-between">
              <button onClick={() => openGraph(graphSubMode)}
                className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors">
                atualizar
              </button>
              {graphSubMode === 'goal' && activeProjectId && (
                <button onClick={() => setGoalFormOpen(true)}
                  className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors">
                  {graphGoalData?.goal ? 'nova meta' : 'definir meta'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Goal form modal */}
      {goalFormOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center">
          <div className="fixed inset-0 bg-black/80" onClick={() => setGoalFormOpen(false)} />
          <div className="relative bg-zinc-900 border border-zinc-700 rounded-2xl w-full max-w-lg max-h-[85vh] flex flex-col shadow-2xl mx-4">
            <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
              <span className="text-sm font-semibold text-zinc-200">Definir meta do projeto</span>
              <button onClick={() => setGoalFormOpen(false)} className="text-zinc-500 hover:text-zinc-300 text-lg">×</button>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
              <div>
                <label className="text-xs text-zinc-400 block mb-1">Título *</label>
                <input value={goalTitle} onChange={e => setGoalTitle(e.target.value)} placeholder="ex: Lançar MVP em produção"
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-500" />
              </div>
              <div>
                <label className="text-xs text-zinc-400 block mb-1">Descrição</label>
                <textarea value={goalDesc} onChange={e => setGoalDesc(e.target.value)} rows={2} placeholder="Contexto da meta…"
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-500 resize-none" />
              </div>
              <div>
                <label className="text-xs text-zinc-400 block mb-1">Prazo</label>
                <input type="date" value={goalTargetDate} onChange={e => setGoalTargetDate(e.target.value)}
                  className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-zinc-500" />
              </div>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs text-zinc-400">Critérios de sucesso</label>
                  <button onClick={() => setGoalCriteria(c => [...c, { id: `c-${Date.now()}`, text: '', done: false }])}
                    className="text-xs text-zinc-500 hover:text-zinc-300">+ adicionar</button>
                </div>
                <div className="space-y-1.5">
                  {goalCriteria.map((c, i) => (
                    <div key={c.id} className="flex items-center gap-2">
                      <input value={c.text} onChange={e => setGoalCriteria(prev => prev.map((x, xi) => xi === i ? { ...x, text: e.target.value } : x))}
                        placeholder={`Critério ${i + 1}`}
                        className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-500" />
                      <button onClick={() => setGoalCriteria(prev => prev.filter((_, xi) => xi !== i))} className="text-zinc-600 hover:text-red-400 text-sm">×</button>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs text-zinc-400">KPIs (opcional)</label>
                  <button onClick={() => setGoalKpis(k => [...k, { metric: '', target: '', unit: '' }])}
                    className="text-xs text-zinc-500 hover:text-zinc-300">+ KPI</button>
                </div>
                <div className="space-y-1.5">
                  {goalKpis.map((k, i) => (
                    <div key={i} className="flex items-center gap-1.5">
                      <input value={k.metric} onChange={e => setGoalKpis(p => p.map((x, xi) => xi === i ? { ...x, metric: e.target.value } : x))}
                        placeholder="métrica" className="flex-[2] bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-500" />
                      <input value={k.target} onChange={e => setGoalKpis(p => p.map((x, xi) => xi === i ? { ...x, target: e.target.value } : x))}
                        placeholder="meta" className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-500" />
                      <input value={k.unit} onChange={e => setGoalKpis(p => p.map((x, xi) => xi === i ? { ...x, unit: e.target.value } : x))}
                        placeholder="unid." className="w-14 bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-500" />
                      <button onClick={() => setGoalKpis(p => p.filter((_, xi) => xi !== i))} className="text-zinc-600 hover:text-red-400 text-sm">×</button>
                    </div>
                  ))}
                  {goalKpis.length === 0 && (
                    <p className="text-[10px] text-zinc-600">Ex: usuários ativos / 100 / usuários</p>
                  )}
                </div>
              </div>
            </div>
            <div className="border-t border-zinc-800 px-6 py-3 flex justify-end gap-2">
              <button onClick={() => setGoalFormOpen(false)} className="text-xs text-zinc-500 hover:text-zinc-300 px-3 py-2">Cancelar</button>
              <button onClick={saveGoal} disabled={savingGoal || !goalTitle.trim()}
                className="bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-xs px-4 py-2 rounded-lg transition-colors">
                {savingGoal ? 'Salvando…' : 'Salvar meta'}
              </button>
            </div>
          </div>
        </div>
      )}

    </main>
  )
}
