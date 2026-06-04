'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { API_URL } from '../lib/api-url'
import { authHeaders, TOKEN_KEY } from '../lib/api-client'
import { useRouter } from 'next/navigation'
import ReactMarkdown from 'react-markdown'
import dynamic from 'next/dynamic'
import { useProjects, type Project, type ImportTab } from './hooks/useProjects'
import { useMemory, type MemoryDoc } from './hooks/useMemory'
import { useGoalGraph, type ProjectGoal, type ProjectState, type GoalGraphData, type SuccessCriteria, type PlanningNode, type GapItem } from './hooks/useGoalGraph'
import { useChatStream, type Message, type Session, type WorkMode } from './hooks/useChatStream'
import { useQA } from './hooks/useQA'
import { useMissions, type MissionStep } from './hooks/useMissions'
const GraphCanvas = dynamic(() => import('./components/GraphCanvas'), { ssr: false })
const UniverseCanvas = dynamic(() => import('./components/UniverseCanvas').then(m => ({ default: m.UniverseCanvas })), { ssr: false })

const MODULE_LABELS: Record<string, string> = {
  brain:   'memory',
  jarvis:  'execution',
  doc:     'documents',
  content: 'content-engine',
  system:  'system',
}

interface ActivityEvent {
  id: string
  source: string
  type: string
  content: string
  intent?: string | null
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

interface EvidenceItem {
  id: string
  projectId: string | null
  type: string
  content: string
  localPath: string | null
  remotePath: string | null
  takenAt: string | null
  prompt: string | null
  description: string | null
  category: string | null
  projectName: string | null
  testRunId?: string | null
  testRunLinkReason?: string | null
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

interface CostModuleRow { module: string; model: string; tokens: number; messages: number; costUSD: number }
interface CostProjectRow { projectId: string | null; projectName: string | null; tokens: number; costUSD: number }
interface CostSummary {
  period: string
  totals: { tokens: number; messages: number; costUSD: number }
  byModule: CostModuleRow[]
  byProject: CostProjectRow[]
  pricing: Record<string, number>
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

function planningTitle(item: string | PlanningNode) {
  return typeof item === 'string' ? item : item.title
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

const MISSION_STATUS_STYLE: Record<string, string> = {
  pending:   'bg-zinc-700 text-zinc-300',
  active:    'bg-blue-500/20 text-blue-400',
  paused:    'bg-amber-500/20 text-amber-400',
  done:      'bg-emerald-500/20 text-emerald-400',
  failed:    'bg-red-500/20 text-red-400',
  cancelled: 'bg-zinc-800 text-zinc-500',
}

function MissionStatusBadge({ status }: { status: string }) {
  return (
    <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded shrink-0 ${MISSION_STATUS_STYLE[status] ?? 'bg-zinc-700 text-zinc-300'}`}>
      {status}
    </span>
  )
}

const STEP_ICON: Record<string, { icon: string; color: string }> = {
  pending: { icon: '○', color: 'text-zinc-600' },
  running: { icon: '⟳', color: 'text-blue-400 animate-spin' },
  done:    { icon: '✓', color: 'text-emerald-500' },
  failed:  { icon: '✗', color: 'text-red-500' },
  skipped: { icon: '–', color: 'text-zinc-600' },
}

function MissionStepRow({ step, index }: { step: MissionStep; index: number }) {
  const [open, setOpen] = useState(false)
  const s = STEP_ICON[step.status] ?? STEP_ICON.pending
  const hasOutput = step.output && Object.keys(step.output).length > 0
  return (
    <div className="rounded-lg bg-zinc-800/40">
      <button
        onClick={() => hasOutput && setOpen(o => !o)}
        className={`w-full flex items-start gap-2 px-2.5 py-1.5 text-left ${hasOutput ? 'hover:bg-zinc-800/70 rounded-lg' : 'cursor-default'}`}
      >
        <span className={`mt-0.5 shrink-0 text-xs ${s.color}`}>{s.icon}</span>
        <div className="min-w-0 flex-1">
          <span className="text-xs text-zinc-300 leading-snug">{index + 1}. {step.title}</span>
          <div className="flex items-center gap-2 mt-0.5">
            <span className={`text-[9px] uppercase font-medium px-1 py-px rounded ${
              step.executor === 'skill' ? 'bg-cyan-500/15 text-cyan-400' :
              step.executor === 'human' ? 'bg-amber-500/15 text-amber-400' :
              'bg-violet-500/15 text-violet-400'
            }`}>{step.executor}</span>
            {step.skillId && <span className="text-[9px] font-mono text-zinc-500">{step.skillId}</span>}
            {step.dependsOn.length > 0 && <span className="text-[9px] text-zinc-600">↳ {step.dependsOn.length} dep</span>}
          </div>
        </div>
        {hasOutput && <span className="text-zinc-600 text-[10px] shrink-0 mt-0.5">{open ? '▲' : '▼'}</span>}
      </button>
      {open && hasOutput && (
        <pre className="text-[10px] text-zinc-400 whitespace-pre-wrap font-mono leading-relaxed px-2.5 pb-2 max-h-48 overflow-y-auto">
          {JSON.stringify(step.output, null, 2)}
        </pre>
      )}
    </div>
  )
}

export default function Home() {
  const router = useRouter()

  // ── domain hooks ─────────────────────────────────────────────────────────────
  const {
    projects, setProjects,
    activeProjectId, setActiveProjectId,
    newProjectOpen, setNewProjectOpen,
    newProjectName, setNewProjectName,
    newProjectDesc, setNewProjectDesc,
    newProjectSlug, setNewProjectSlug,
    creatingProject,
    onboardStep, setOnboardStep,
    onboardProjectId,
    onboardSrcTab, setOnboardSrcTab,
    onboardIndexing,
    onboardIndexResult,
    onboardGoalTitle, setOnboardGoalTitle,
    onboardGoalDate, setOnboardGoalDate,
    onboardGoalCriteria, setOnboardGoalCriteria,
    onboardSavingGoal,
    importOpen, setImportOpen,
    importTab, setImportTab,
    importLoading,
    importResult, setImportResult,
    githubUser, setGithubUser,
    githubRepo, setGithubRepo,
    githubToken, setGithubToken,
    importUrl, setImportUrl,
    notionToken, setNotionToken,
    notionPageId, setNotionPageId,
    createProject, closeNewProject,
    onboardIndexSource, onboardCreateGoal,
    deleteProject, renameProject,
    handleImportGithub, handleImportUrl, handleImportFile, handleImportNotion,
  } = useProjects()

  const {
    memoryOpen, setMemoryOpen,
    memoryDocs, setMemoryDocs,
    memoryDocsLoading,
    memorySearch, setMemorySearch,
    memoryListFilter, setMemoryListFilter,
    memorySearchResults, setMemorySearchResults,
    memorySearching,
    openMemoryPanel,
    handleMemorySearch,
  } = useMemory(activeProjectId)

  const {
    graphOpen, setGraphOpen,
    graphSubMode, setGraphSubMode,
    graphStateData, setGraphStateData,
    graphGoalData,
    graphLoading,
    graphStateRefreshing,
    graphEventData,
    graphEventLoading,
    knowledgeData,
    knowledgeLoading,
    loadKnowledgeGraph,
    universeData,
    universeLoading,
    universeSaving,
    universeImporting,
    loadUniverse,
    saveUniverse,
    importUniverse,
    goalsHistory, setGoalsHistory,
    historyOpen,
    historyLoading,
    editingKpi, setEditingKpi,
    kpiDraft, setKpiDraft,
    autoTrackingKpis,
    goalFormOpen, setGoalFormOpen,
    editingGoalId,
    goalTitle, setGoalTitle,
    goalDesc, setGoalDesc,
    goalTargetDate, setGoalTargetDate,
    goalCriteria, setGoalCriteria,
    goalKpis, setGoalKpis,
    savingGoal,
    openGraph,
    refreshGraphState,
    loadEventGraph,
    resetGoalForm,
    openCreateGoalForm,
    openEditGoalForm,
    saveGoal,
    toggleCriteria,
    loadGoalsHistory,
    toggleHistory,
    achieveGoal,
    deleteGoal,
    saveKpi,
    saveCriteria,
    saveGoalKpis,
    autoTrackKpis,
  } = useGoalGraph(activeProjectId)

  const {
    messages, setMessages,
    input, setInput,
    loading,
    sessionId, setSessionId,
    sessionTokens, setSessionTokens,
    dailyTokens, setDailyTokens,
    playingIndex,
    autoVoice, setAutoVoice,
    recording,
    transcribing,
    workMode, setWorkMode,
    sessions,
    sidebarOpen, setSidebarOpen,
    loadingSession,
    deletingSession,
    bottomRef,
    messagesContainerRef,
    shouldAutoScrollRef,
    submitMessageRef,
    drainQueue,
    playAudio,
    sendMessage,
    toggleRecording,
    loadSessions,
    openSidebar,
    loadSession,
    deleteSession,
    newChat,
  } = useChatStream(activeProjectId)

  const {
    qaOpen, setQaOpen,
    qaTab,
    qaSummary,
    qaTrend,
    qaRuns,
    qaRunDetail,
    qaLoading,
    qaTrendLoading,
    qaRunsLoading,
    qaRunDetailLoading,
    dqSummary,
    dqLoading,
    catalogAssets,
    catalogLoading,
    openQA,
    switchTab: switchQATab,
    selectRun: selectQARun,
  } = useQA(activeProjectId)

  const {
    missionsOpen, setMissionsOpen,
    missions,
    missionsLoading,
    selectedMission, setSelectedMission,
    missionDetailLoading,
    creating: missionCreating,
    executing: missionExecuting,
    applyingTemplate: missionApplyingTemplate,
    routeNote: missionRouteNote,
    openMissions,
    selectMission,
    createMission,
    executeMission,
    applyTemplate: applyMissionTemplate,
  } = useMissions(activeProjectId)
  const [missionInput, setMissionInput] = useState('')

  // ── local state (panels not yet extracted) ───────────────────────────────────
  const [activityOpen, setActivityOpen] = useState(false)
  const [activityEvents, setActivityEvents] = useState<ActivityEvent[]>([])
  const [activityLoading, setActivityLoading] = useState(false)
  const [hookHealth, setHookHealth] = useState<{ status: string; lastCliEvent: string | null } | null>(null)
  const [memoryClassFilter, setMemoryClassFilter] = useState<MemoryClassFilter>('all')
  const [highSignalOnly, setHighSignalOnly] = useState(true)
  const [synthesisOpen, setSynthesisOpen] = useState(false)
  const [synthesisArtifacts, setSynthesisArtifacts] = useState<SynthesisArtifact[]>([])
  const [synthesisLoading, setSynthesisLoading] = useState(false)
  const [synthesizing, setSynthesizing] = useState(false)
  const [docsOpen, setDocsOpen] = useState(false)
  const [projectDocs, setProjectDocs] = useState<ProjectDoc[]>([])
  const [docsLoading, setDocsLoading] = useState(false)
  const [evidenceOpen, setEvidenceOpen] = useState(false)
  const [evidenceItems, setEvidenceItems] = useState<EvidenceItem[]>([])
  const [evidenceLoading, setEvidenceLoading] = useState(false)
  const [evidenceFilter, setEvidenceFilter] = useState<'all' | 'with_run' | 'without_run'>('all')
  const [deletingEvidenceId, setDeletingEvidenceId] = useState<string | null>(null)
  const [generatingDocs, setGeneratingDocs] = useState(false)
  const [activeDocType, setActiveDocType] = useState<string>('project_state')
  const [syncing, setSyncing] = useState(false)
  const [syncResult, setSyncResult] = useState<{ synced: number; conflicts: Array<{type: string; vaultModifiedAt: string}> } | null>(null)
  const [notionSyncing, setNotionSyncing] = useState(false)
  const [notionSyncResult, setNotionSyncResult] = useState<{ synced: Array<{type:string;url:string;status:string}>; skipped: string[]; projectPageId: string } | null>(null)
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
  const [costsOpen, setCostsOpen] = useState(false)
  const [costsPeriod, setCostsPeriod] = useState<'today'|'week'|'month'|'all'>('month')
  const [costsData, setCostsData] = useState<CostSummary | null>(null)
  const [costsLoading, setCostsLoading] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [resumeCopied, setResumeCopied] = useState(false)
  const [blueprintOpen, setBlueprintOpen] = useState(false)
  const [blueprintCopied, setBlueprintCopied] = useState<string | null>(null)
  const [blueprintTab, setBlueprintTab] = useState<'templates' | 'history' | 'upload'>('templates')
  const [blueprintHistory, setBlueprintHistory] = useState<{id:string;title:string;source:string;format:string;mode:string|null;wikiPages:string[];eventCount:number;nextSteps:string[];warnings:string[];createdAt:string}[]>([])
  const [blueprintHistoryLoading, setBlueprintHistoryLoading] = useState(false)
  const [blueprintUploadTitle, setBlueprintUploadTitle] = useState('')
  const [blueprintUploadContent, setBlueprintUploadContent] = useState('')
  const [blueprintUploadFileName, setBlueprintUploadFileName] = useState('')
  const [blueprintUploadPreview, setBlueprintUploadPreview] = useState<{detectedSections:string[];suggestedWikiPages:string[];suggestedNextSteps:string[];risks:string[]} | null>(null)
  const [blueprintUploadResult, setBlueprintUploadResult] = useState<{ok:boolean;created:{wikiPages:string[];events:string[];nextSteps:string[]};warnings:string[]} | null>(null)
  const [blueprintUploadLoading, setBlueprintUploadLoading] = useState(false)

  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const token = localStorage.getItem(TOKEN_KEY)
    if (!token) { router.push('/login'); return }
  }, [router])

  useEffect(() => {
    if (!shouldAutoScrollRef.current) return
    bottomRef.current?.scrollIntoView({ behavior: 'auto' })
  }, [messages])

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

  // Saúde do hook: independe do filtro de classe — reflete se eventos cli chegam
  const loadHookHealth = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/events/hook/health`, { headers: authHeaders() })
      const data = await res.json() as { projects: Array<{ projectId: string; status: string; lastCliEvent: string | null }> }
      const mine = data.projects?.find((p) => p.projectId === activeProjectId)
      setHookHealth(mine ? { status: mine.status, lastCliEvent: mine.lastCliEvent } : null)
    } catch {
      setHookHealth(null)
    }
  }, [activeProjectId])

  const openActivity = useCallback(async () => {
    setActivityOpen(true)
    setMemoryClassFilter('all')
    loadActivityEvents('all')
    loadHookHealth()
  }, [loadActivityEvents, loadHookHealth])

  useEffect(() => {
    if (!activityOpen) return
    const id = setInterval(() => { loadActivityEvents(memoryClassFilter); loadHookHealth() }, 5000)
    return () => clearInterval(id)
  }, [activityOpen, memoryClassFilter, loadActivityEvents, loadHookHealth])

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

  const loadEvidence = useCallback(async () => {
    if (!activeProjectId) return
    setEvidenceLoading(true)
    try {
      const res = await fetch(`${API_URL}/evidence/projects/${activeProjectId}`, { headers: authHeaders() })
      setEvidenceItems(await res.json() as EvidenceItem[])
    } catch {
      setEvidenceItems([])
    } finally {
      setEvidenceLoading(false)
    }
  }, [activeProjectId])

  const openEvidence = useCallback(async () => {
    if (!activeProjectId) return
    setEvidenceOpen(true)
    setEvidenceFilter('all')
    await loadEvidence()
  }, [activeProjectId, loadEvidence])

  const deleteEvidence = useCallback(async (evidenceId: string) => {
    if (!confirm('Excluir esta evidencia? O registro e o arquivo sincronizado serao removidos.')) return
    setDeletingEvidenceId(evidenceId)
    try {
      const res = await fetch(`${API_URL}/evidence/${evidenceId}`, { method: 'DELETE', headers: authHeaders() })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setEvidenceItems(prev => prev.filter(item => item.id !== evidenceId))
    } catch {
      alert('N?o foi poss?vel excluir a evidencia.')
    } finally {
      setDeletingEvidenceId(null)
    }
  }, [])

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
      await fetch(`${API_URL}/documentation/generate/${activeProjectId}?force=true`, {
        method: 'POST',
        headers: authHeaders(),
      })
      const res = await fetch(`${API_URL}/documentation/${activeProjectId}`, { headers: authHeaders() })
      setProjectDocs(await res.json() as ProjectDoc[])
    } catch (e) {
      console.error('Erro ao regenerar docs:', e)
    }
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

  const syncNotion = useCallback(async () => {
    if (!activeProjectId) return
    setNotionSyncing(true)
    setNotionSyncResult(null)
    try {
      const res = await fetch(`${API_URL}/notion/sync/${activeProjectId}`, {
        method: 'POST',
        headers: authHeaders(),
      })
      if (res.ok) setNotionSyncResult(await res.json())
    } catch { /* silencioso */ }
    finally { setNotionSyncing(false) }
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

  const loadCosts = useCallback(async (period: 'today'|'week'|'month'|'all', projectId?: string) => {
    setCostsLoading(true)
    try {
      const qs = `period=${period}${projectId ? `&project_id=${projectId}` : ''}`
      const res = await fetch(`${API_URL}/costs/summary?${qs}`, { headers: authHeaders() })
      if (res.ok) setCostsData(await res.json() as CostSummary)
    } catch { /* silencioso */ }
    finally { setCostsLoading(false) }
  }, [])

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
    setRecommendations([])
    try {
      await fetch(`${API_URL}/projects/${activeProjectId}/health/compute`, {
        method: 'POST',
        headers: authHeaders(),
      }).catch(() => null)
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
    <main className="h-screen overflow-hidden flex flex-col">
      <div className="hud-scanline" aria-hidden="true" />

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
                  <div className="flex gap-2">
                    <input
                      value={newProjectSlug}
                      onChange={(e) => setNewProjectSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-_]/g, ''))}
                      placeholder="ex: rayzen-pdv"
                      className="flex-1 bg-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 outline-none focus:ring-1 focus:ring-zinc-600 font-mono"
                    />
                    <label
                      title="Selecionar pasta"
                      className="px-3 py-2 bg-zinc-700 hover:bg-zinc-600 rounded-lg text-zinc-300 hover:text-zinc-100 transition-colors text-sm cursor-pointer"
                    >
                      📁
                      <input
                        type="file"
                        // @ts-expect-error — webkitdirectory não está no tipo padrão
                        webkitdirectory=""
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0]
                          if (!file) return
                          const parts = file.webkitRelativePath.split('/')
                          const folderName = parts[0].toLowerCase().replace(/[^a-z0-9-_]/g, '-')
                          setNewProjectSlug(folderName)
                          if (!newProjectName.trim()) setNewProjectName(parts[0])
                          e.target.value = ''
                        }}
                      />
                    </label>
                  </div>
                  <p className="text-[10px] text-zinc-600 mt-1">O hook do Claude detecta automaticamente o projeto por este nome · ou clique em 📁 para selecionar a pasta</p>
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
                {onboardIndexResult && (
                  <p className={`text-xs rounded-lg px-3 py-2 ${onboardIndexResult.startsWith('Erro') ? 'bg-red-950 text-red-400' : 'bg-zinc-800 text-zinc-300'}`}>
                    {onboardIndexResult}
                  </p>
                )}
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

      {/* Missions modal (V2) */}
      {missionsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="fixed inset-0 bg-black/70" onClick={() => setMissionsOpen(false)} />
          <div className="relative z-50 w-full max-w-2xl bg-zinc-900 border border-zinc-800 rounded-2xl mx-4 max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
              <div>
                <p className="text-sm font-semibold">◇ Missões <span className="text-[10px] font-mono text-violet-400/80 ml-1">V2</span></p>
                <p className="text-[10px] text-zinc-500">Router classifica e planeja · Workflow DAG executa com Specialist</p>
              </div>
              <button onClick={() => setMissionsOpen(false)} className="text-zinc-500 hover:text-zinc-300 text-xs">fechar</button>
            </div>

            <div className="overflow-y-auto flex-1 px-6 py-4 space-y-4">
              {/* Criar missão */}
              <div className="space-y-2">
                <textarea
                  value={missionInput}
                  onChange={(e) => setMissionInput(e.target.value)}
                  placeholder="Descreva o objetivo da missão em linguagem natural — o Router planeja os steps."
                  rows={2}
                  className="w-full bg-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 outline-none focus:ring-1 focus:ring-zinc-600 resize-none"
                />
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] text-zinc-600">POST /v2/route · mode: mission</span>
                  <button
                    onClick={async () => { await createMission(missionInput); setMissionInput('') }}
                    disabled={missionCreating || !missionInput.trim()}
                    className="bg-violet-600 hover:bg-violet-500 text-white rounded-lg px-3 py-1.5 text-xs font-medium disabled:opacity-40 transition-colors"
                  >
                    {missionCreating ? 'Planejando…' : 'Criar missão'}
                  </button>
                </div>
                {missionRouteNote && (
                  <p className="text-xs bg-red-950 text-red-400 rounded-lg px-3 py-2">{missionRouteNote}</p>
                )}
              </div>

              {/* Detalhe da missão selecionada */}
              {selectedMission ? (
                <div className="border border-zinc-800 rounded-xl">
                  <div className="flex items-start justify-between gap-2 px-4 py-3 border-b border-zinc-800">
                    <div className="min-w-0">
                      <button onClick={() => setSelectedMission(null)} className="text-[10px] text-zinc-500 hover:text-zinc-300 mb-1">← voltar à lista</button>
                      <p className="text-sm text-zinc-200 leading-snug">{selectedMission.title}</p>
                      <p className="text-[11px] text-zinc-500 mt-0.5 line-clamp-2">{selectedMission.objective}</p>
                    </div>
                    <div className="flex flex-col items-end gap-1.5 shrink-0">
                      <MissionStatusBadge status={selectedMission.status} />
                      {['pending', 'active'].includes(selectedMission.status) && (
                        <button
                          onClick={() => executeMission(selectedMission.id)}
                          disabled={missionExecuting || selectedMission.steps.length === 0}
                          className="bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg px-2.5 py-1 text-[11px] font-medium disabled:opacity-40 transition-colors"
                          title={selectedMission.steps.length === 0 ? 'Missão sem steps' : 'Executar Workflow DAG'}
                        >
                          {missionExecuting ? 'Executando…' : '▶ Executar'}
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="px-4 py-3 space-y-1.5">
                    {selectedMission.status === 'done' && (
                      <div className="mb-2 flex items-center gap-2 px-1 py-1.5 bg-emerald-950/40 rounded-lg border border-emerald-900/50">
                        <span className="text-emerald-400 text-xs">✓</span>
                        <span className="text-[11px] text-emerald-300">Documentação gerada automaticamente</span>
                        <button
                          onClick={() => { setMissionsOpen(false); openDocs() }}
                          className="ml-auto text-[10px] text-zinc-400 hover:text-zinc-200 underline"
                        >
                          ver docs
                        </button>
                      </div>
                    )}
                    {selectedMission.steps.length === 0 && (
                      <div className="py-3 space-y-2">
                        <p className="text-xs text-zinc-500 text-center">
                          O Router não gerou steps. Aplique um template:
                        </p>
                        <div className="flex gap-1.5 justify-center flex-wrap">
                          {(['review', 'implementation', 'debugging'] as const).map(tpl => (
                            <button
                              key={tpl}
                              onClick={() => applyMissionTemplate(selectedMission.id, tpl)}
                              disabled={missionApplyingTemplate}
                              className="bg-zinc-700 hover:bg-zinc-600 text-zinc-200 rounded-lg px-2.5 py-1 text-[11px] font-medium disabled:opacity-40 transition-colors capitalize"
                            >
                              {missionApplyingTemplate ? '…' : tpl}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                    {selectedMission.steps.map((step, i) => (
                      <MissionStepRow key={step.id} step={step} index={i} />
                    ))}
                  </div>
                </div>
              ) : (
                /* Lista de missões */
                <div className="space-y-2">
                  <p className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wide">Missões do projeto</p>
                  {missionsLoading && <p className="text-zinc-500 text-xs text-center py-6">carregando…</p>}
                  {!missionsLoading && missions.length === 0 && (
                    <p className="text-zinc-500 text-xs text-center py-6">Nenhuma missão ainda. Crie a primeira acima.</p>
                  )}
                  {missions.map((m) => (
                    <button
                      key={m.id}
                      onClick={() => selectMission(m.id)}
                      className="w-full text-left border border-zinc-800 hover:border-zinc-700 bg-zinc-900 hover:bg-zinc-800 rounded-xl px-3 py-2.5 transition-colors"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-xs text-zinc-200 leading-snug">{m.title}</span>
                        <MissionStatusBadge status={m.status} />
                      </div>
                      <div className="flex items-center gap-3 mt-1.5">
                        <span className="text-[10px] text-zinc-600">{new Date(m.createdAt).toLocaleString('pt-BR')}</span>
                        <span className="text-[10px] text-zinc-600">{m.steps.length} {m.steps.length === 1 ? 'step' : 'steps'}</span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
              {missionDetailLoading && <p className="text-zinc-500 text-xs text-center py-2">atualizando detalhe…</p>}
            </div>
          </div>
        </div>
      )}

      {/* Costs modal */}
      {costsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="fixed inset-0 bg-black/70" onClick={() => setCostsOpen(false)} />
          <div className="relative z-50 w-full max-w-lg bg-zinc-900 border border-zinc-800 rounded-2xl mx-4 max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
              <div>
                <p className="text-sm font-semibold">◈ Análise de custos LLM</p>
                <p className="text-[10px] text-zinc-500">Estimativa baseada em tokens registrados por módulo</p>
              </div>
              <button onClick={() => setCostsOpen(false)} className="text-zinc-500 hover:text-zinc-300 text-xs">fechar</button>
            </div>
            <div className="px-6 pt-3 pb-2 flex gap-2">
              {(['today','week','month','all'] as const).map(p => (
                <button
                  key={p}
                  onClick={() => { setCostsPeriod(p); loadCosts(p, activeProjectId ?? undefined) }}
                  className={`text-xs px-2.5 py-1 rounded-lg transition-colors ${costsPeriod === p ? 'bg-violet-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'}`}
                >
                  {p === 'today' ? 'Hoje' : p === 'week' ? '7 dias' : p === 'month' ? 'Mês' : 'Tudo'}
                </button>
              ))}
            </div>
            <div className="overflow-y-auto flex-1 px-6 py-3 space-y-5">
              {costsLoading && <p className="text-zinc-500 text-xs text-center py-6">carregando...</p>}
              {!costsLoading && costsData && (
                <>
                  {/* Totals */}
                  <div className="grid grid-cols-3 gap-3">
                    {[
                      { label: 'Tokens', value: costsData.totals.tokens.toLocaleString('pt-BR') },
                      { label: 'Mensagens', value: costsData.totals.messages.toLocaleString('pt-BR') },
                      { label: 'Custo est.', value: `$${costsData.totals.costUSD.toFixed(4)}` },
                    ].map(({ label, value }) => (
                      <div key={label} className="bg-zinc-800/60 rounded-xl p-3 text-center">
                        <p className="text-[10px] text-zinc-500 mb-1">{label}</p>
                        <p className="text-sm font-mono font-semibold text-zinc-200">{value}</p>
                      </div>
                    ))}
                  </div>

                  {/* By module */}
                  {costsData.byModule.length > 0 && (
                    <div>
                      <p className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wide mb-2">Por módulo</p>
                      <div className="space-y-1">
                        {costsData.byModule.map((r) => {
                          const pct = costsData.totals.tokens > 0 ? Math.round((r.tokens / costsData.totals.tokens) * 100) : 0
                          return (
                            <div key={r.module} className="flex items-center gap-2">
                              <div className="w-24 text-xs text-zinc-300 truncate font-mono">{r.module}</div>
                              <div className="flex-1 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                                <div className="h-full bg-violet-500 rounded-full" style={{ width: `${pct}%` }} />
                              </div>
                              <div className="text-[10px] text-zinc-500 w-12 text-right">{pct}%</div>
                              <div className="text-[10px] font-mono text-zinc-400 w-16 text-right">${r.costUSD.toFixed(4)}</div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )}

                  {/* By project */}
                  {!activeProjectId && costsData.byProject.length > 0 && (
                    <div>
                      <p className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wide mb-2">Por projeto</p>
                      <div className="space-y-1">
                        {costsData.byProject.map((r, i) => (
                          <div key={i} className="flex items-center justify-between text-xs">
                            <span className="text-zinc-300 truncate flex-1">{r.projectName ?? 'sem projeto'}</span>
                            <span className="font-mono text-zinc-400 ml-2">{r.tokens.toLocaleString('pt-BR')} tok</span>
                            <span className="font-mono text-violet-400 ml-2 w-16 text-right">${r.costUSD.toFixed(4)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Pricing reference */}
                  <div>
                    <p className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wide mb-2">Tabela de preços ($/1M tokens)</p>
                    <div className="grid grid-cols-2 gap-1">
                      {Object.entries(costsData.pricing).map(([model, price]) => (
                        <div key={model} className="flex items-center justify-between text-[10px] bg-zinc-800/40 rounded px-2 py-1">
                          <span className="text-zinc-400 font-mono">{model}</span>
                          <span className="text-zinc-300">${price.toFixed(2)}</span>
                        </div>
                      ))}
                    </div>
                    <p className="text-[9px] text-zinc-600 mt-2">* Estimativa conservadora usando preços Groq/Anthropic 2025. Custo real depende de fallbacks e preços negociados.</p>
                  </div>
                </>
              )}
              {!costsLoading && !costsData && (
                <p className="text-zinc-500 text-xs text-center py-6">Nenhum dado de custo disponível para o período.</p>
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
                    <li key={i} className="text-xs text-zinc-300 flex gap-1"><span className="text-red-500">■</span>{planningTitle(b)}</li>
                  ))}</ul>
                </div>
              )}
              {projectState.nextSteps.length > 0 && (
                <div>
                  <p className="text-[10px] font-semibold text-amber-400 uppercase tracking-wide mb-1">Próximos passos</p>
                  <ul className="space-y-1">{projectState.nextSteps.map((s, i) => (
                    <li key={i} className="text-xs text-zinc-300 flex gap-1"><span className="text-amber-500">→</span>{planningTitle(s)}</li>
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
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold">
                  Atividade{activeProjectId && projects.find(p => p.id === activeProjectId) ? ` — ${projects.find(p => p.id === activeProjectId)!.name}` : ''}
                </h2>
                {activeProjectId && hookHealth && (() => {
                  const ts = hookHealth.lastCliEvent ? new Date(hookHealth.lastCliEvent).getTime() : 0
                  const ageMin = ts ? Math.floor((Date.now() - ts) / 60000) : Infinity
                  const live = ageMin < 10
                  const ago = !ts ? 'sem eventos'
                    : ageMin < 1 ? 'agora'
                    : ageMin < 60 ? `há ${ageMin}min`
                    : ageMin < 1440 ? `há ${Math.floor(ageMin / 60)}h`
                    : `há ${Math.floor(ageMin / 1440)}d`
                  const color = live ? 'bg-emerald-500' : ageMin < 1440 ? 'bg-amber-500' : 'bg-red-500'
                  return (
                    <span
                      title={`Hook ${hookHealth.status} · último evento ${ago}`}
                      className="flex items-center gap-1 text-[10px] text-zinc-400"
                    >
                      <span className={`w-2 h-2 rounded-full ${color} ${live ? 'animate-pulse' : ''}`} />
                      {live ? 'ao vivo' : ago}
                    </span>
                  )
                })()}
              </div>
              <button onClick={() => setActivityOpen(false)} className="text-zinc-500 hover:text-zinc-300 text-xs">fechar</button>
            </div>
            <div className="flex gap-1 mb-3 flex-wrap items-center">
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
              <button
                onClick={() => setHighSignalOnly(v => !v)}
                title="Filtrar apenas eventos com sinal semântico"
                className={`ml-auto text-[10px] px-2 py-1 rounded-lg font-medium transition-colors ${
                  highSignalOnly ? 'bg-violet-700 text-white' : 'bg-zinc-800 text-zinc-500 hover:text-zinc-300'
                }`}
              >
                ✦ sinal
              </button>
            </div>
            <div className="overflow-y-auto flex-1 space-y-2">
              {activityLoading && <p className="text-zinc-500 text-xs text-center py-4">Carregando…</p>}
              {!activityLoading && activityEvents.length === 0 && (
                <p className="text-zinc-500 text-xs text-center py-4">Nenhum evento registrado ainda.</p>
              )}
              {activityEvents.filter(ev => {
                if (!highSignalOnly) return true
                // Remove eventos de baixo sinal: leituras MCP, tool calls sem intent de source cli
                if (ev.content.startsWith('Read:')) return false
                if (ev.source === 'cli' && !ev.intent && ev.type === 'execution') return false
                return true
              }).map((ev) => {
                const git = (ev.metadata as Record<string, unknown>)?.['git'] as Record<string, unknown> | null
                const evidenceType = typeof ev.metadata?.['evidenceType'] === 'string' ? ev.metadata['evidenceType'] : null
                const evidencePath = typeof ev.metadata?.['path'] === 'string' ? ev.metadata['path'] : null
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
                      {ev.intent && (
                        <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold ${
                          ev.intent === 'decision'   ? 'bg-purple-900 text-purple-300' :
                          ev.intent === 'problem'    ? 'bg-red-900 text-red-300' :
                          ev.intent === 'checkpoint' ? 'bg-emerald-900 text-emerald-300' :
                          ev.intent === 'idea'       ? 'bg-yellow-900 text-yellow-300' :
                          'bg-zinc-800 text-zinc-500'
                        }`}>{ev.intent}</span>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-zinc-300 truncate">
                        {evidenceType === 'screenshot' ? '📸 ' : ''}
                        {ev.content}
                      </p>
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
                        {evidenceType === 'screenshot' && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded bg-cyan-900 text-cyan-300 font-medium">evidência</span>
                        )}
                        {evidencePath && (
                          <span className="text-[10px] font-mono text-zinc-600 truncate max-w-[320px]" title={evidencePath}>
                            {evidencePath}
                          </span>
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
                <button
                  onClick={syncNotion}
                  disabled={notionSyncing || !activeProjectId}
                  className="text-xs bg-orange-700 hover:bg-orange-600 disabled:opacity-40 text-white px-3 py-1.5 rounded-lg transition-colors"
                  title="Publicar documentação no Notion"
                >
                  {notionSyncing ? 'Publicando…' : 'N Notion'}
                </button>
                <button onClick={() => { setDocsOpen(false); setSyncResult(null); setNotionSyncResult(null) }} className="text-zinc-500 hover:text-zinc-300 text-xs">fechar</button>
              </div>
            </div>
            {/* Notion sync result */}
            {notionSyncResult && (
              <div className="px-6 py-3 text-xs border-b border-zinc-800 bg-orange-950/30">
                <div className="flex items-start justify-between gap-2">
                  <div className="space-y-1">
                    {notionSyncResult.synced.length > 0 ? (
                      <>
                        <p className="text-orange-300 font-medium">{notionSyncResult.synced.length} doc(s) publicado(s) no Notion</p>
                        {notionSyncResult.synced.map(s => (
                          <div key={s.type} className="flex items-center gap-2">
                            <span className={`text-[10px] px-1.5 py-0.5 rounded ${s.status === 'created' ? 'bg-emerald-900/50 text-emerald-400' : 'bg-zinc-700 text-zinc-400'}`}>{s.status}</span>
                            <span className="text-zinc-400">{s.type}</span>
                            <a href={s.url} target="_blank" rel="noreferrer" className="text-orange-400 hover:text-orange-300 underline text-[10px]">abrir ↗</a>
                          </div>
                        ))}
                      </>
                    ) : (
                      <p className="text-zinc-500">Nenhum documento sincronizado. Gere a documentação primeiro.</p>
                    )}
                    {notionSyncResult.skipped.length > 0 && (
                      <p className="text-amber-400 mt-1">Ignorados: {notionSyncResult.skipped.join(', ')}</p>
                    )}
                  </div>
                  <button onClick={() => setNotionSyncResult(null)} className="text-zinc-600 hover:text-zinc-400 shrink-0">×</button>
                </div>
              </div>
            )}
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
                { type: 'test_evidence', label: 'Evidencias de teste' },
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
      <div className="hud-header shrink-0 sticky top-0 z-30 px-6 py-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 shrink-0">
          <button
            onClick={openSidebar}
            style={{color:'var(--hud-dim)'}}
            className="hover:text-white transition-colors"
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
            style={{color:'var(--hud-dim)'}}
            className="hover:text-white transition-colors"
            title="Configurações"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="3"/>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
            </svg>
          </button>
          <button
            onClick={openMemoryPanel}
            style={{color:'var(--hud-dim)'}}
            className="hover:text-white transition-colors"
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
            style={{color:'var(--hud-dim)'}}
            className="hover:text-white transition-colors"
            title="Indexar no Brain"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
          </button>
          <div className="flex items-center gap-2.5 shrink-0">
            <img src="/rayzen-icon.svg" width="34" height="34" alt="" aria-hidden="true" className="shrink-0" />
            <div>
              <h1 className="hud-title text-base font-bold whitespace-nowrap">RAYZEN AI</h1>
              <p className="text-[10px] mt-0.5 whitespace-nowrap" style={{color:'var(--hud-dim)'}}>SID: {sessionId.slice(0, 8)}…</p>
            </div>
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
              onClick={() => { setStateOpen(true); loadProjectState(activeProjectId!) }}
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
          <button
            onClick={() => { setCostsOpen(true); loadCosts(costsPeriod, activeProjectId ?? undefined) }}
            className="flex items-center gap-1 text-xs text-zinc-500 hover:text-violet-400 transition-colors font-mono"
            title="Análise de custos LLM"
          >
            ◈ costs
          </button>
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
              className="hud-nav"
              title="Captura rápida: decisão, ideia, problema"
            >
              + capturar
            </button>
          )}
          {activeProjectId && (
            <button
              onClick={doCheckpoint}
              disabled={checkpointing}
              className="hud-nav"
              title="Checkpoint: sintetiza atividade recente"
            >
              {checkpointing ? '…' : 'checkpoint'}
            </button>
          )}
          <button
            onClick={openActivity}
            className="hud-nav"
          >
            atividade
          </button>
          {activeProjectId && (
            <button
              onClick={() => openGraph('goal')}
              className="hud-nav"
              title="Goal Graph — meta vs estado atual"
            >
              grafo
            </button>
          )}
          {activeProjectId && (
            <button
              onClick={openMissions}
              className="hud-nav"
              title="Missões V2 — criar e executar Workflow DAG"
            >
              missões
            </button>
          )}
          {activeProjectId && (
            <a
              href="/work-panel"
              className="hud-nav"
              title="Work Panel — conversa, contexto comprimido e execução assistida com aprovação por etapa"
            >
              work panel
            </a>
          )}
          <a href="/catalog" className="hud-nav" title="Catalog — projetos como assets formais com owner, provenance e tags">
            catalog
          </a>
          <a
            href="/discovery"
            className="hud-nav"
            title="Descoberta — entrevista de intake, Blueprint e criação do projeto (padrão Rayzen)"
          >
            novo projeto
          </a>
          {activeProjectId && (
            <button
              onClick={openQA}
              className="hud-nav"
              title="Dashboard QA — runs, falhas e tendência"
            >
              qa
            </button>
          )}
          {activeProjectId && (
            <button
              onClick={openEvidence}
              className="hud-nav"
              title="Evidências visuais do projeto"
            >
              evidências
            </button>
          )}
          <button
            onClick={() => setAutoVoice((v) => !v)}
            className={`hud-nav ${autoVoice ? 'active' : ''}`}
            title="Ler respostas do assistente em voz alta automaticamente"
          >
            voz {autoVoice ? 'on' : 'off'}
          </button>
          <button
            onClick={openSynthesis}
            className="hud-nav"
          >
            síntese
          </button>
          {activeProjectId && (
            <button
              onClick={openDocs}
              className="hud-nav"
            >
              docs
            </button>
          )}
          <button
            onClick={() => {
              document.cookie = 'rayzen_token=; path=/; max-age=0'
              localStorage.removeItem(TOKEN_KEY)
              router.push('/login')
            }}
            className="hud-nav"
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
        {messages.length === 0 && !activeProjectId && (
          <div className="mt-10 rounded-2xl border border-zinc-800 bg-zinc-900/70 p-5 text-sm text-zinc-300">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">sem projeto ativo</p>
            <h2 className="mt-2 text-base font-semibold text-zinc-100">Recomendação para o primeiro dia</h2>
            <ol className="mt-3 space-y-3 text-zinc-400">
              <li className="flex gap-2">
                <span className="text-cyan-400 font-semibold shrink-0">1.</span>
                <span>Crie o projeto aqui no Rayzen clicando no <span className="text-zinc-200">+</span> — uma página é criada automaticamente no Notion.</span>
              </li>
              <li className="flex gap-2">
                <span className="text-cyan-400 font-semibold shrink-0">2.</span>
                <span>Abra a pasta do projeto no VS Code — o hook vincula automaticamente pelo nome do repositório Git, sem configuração manual.</span>
              </li>
              <li className="flex gap-2">
                <span className="text-cyan-400 font-semibold shrink-0">3.</span>
                <span>Faça um <span className="text-zinc-200">checkpoint manual</span> com uma nota descrevendo o escopo inicial — isso ancora o estado do projeto antes de ter eventos.</span>
              </li>
              <li className="flex gap-2">
                <span className="text-cyan-400 font-semibold shrink-0">4.</span>
                <span>No <span className="text-zinc-200">Goal Graph</span>, crie a primeira meta com critérios de sucesso — é o que vai medir progresso real ao longo do tempo.</span>
              </li>
            </ol>
            <p className="mt-4 text-xs text-zinc-500">
              Cada VS Code aberto em uma pasta diferente envia eventos para o projeto correto automaticamente. Dois projetos em paralelo funcionam sem configuração extra.
            </p>
          </div>
        )}
        {messages.length === 0 && activeProjectId && (
          <div className="hud-empty mt-20">AGUARDANDO INPUT</div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[80%] px-4 py-3 text-sm leading-relaxed ${
                msg.role === 'user' ? 'hud-msg-user' : 'hud-msg-ai'
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
            <div className="hud-msg-ai px-4 py-3">
              <div className="hud-dots">
                <span /><span /><span />
              </div>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="hud-input-bar shrink-0 px-4 py-4">
        {/* Blueprint modal */}
        {blueprintOpen && (() => {
          const loadHistory = async () => {
            if (!activeProjectId) return
            setBlueprintHistoryLoading(true)
            try {
              const res = await fetch(`${API_URL}/projects/${activeProjectId}/blueprint/imports`, { headers: authHeaders() })
              if (res.ok) setBlueprintHistory(await res.json())
            } finally {
              setBlueprintHistoryLoading(false)
            }
          }

          const PROMPT_FULL = `Estruture esta ideia no modelo Rayzen Blueprint.

Quero um Blueprint em Markdown pronto para importar no Rayzen AI usando \`rayzen_blueprint_import_markdown\`.

Use esta estrutura:

# [Nome da Ideia / Feature / Projeto]

## 1. Resumo executivo
Explique em poucas linhas o que é a ideia e por que ela existe.

## 2. Problema
Descreva o problema real que isso resolve.

## 3. Objetivo
Explique o objetivo principal da implementação.

## 4. Contexto atual
Descreva o que já existe no projeto, o que não existe e quais partes serão aproveitadas.

## 5. Solução proposta
Explique a solução de forma prática e técnica.

## 6. Arquitetura
Descreva os módulos, fluxo, camadas e integrações.

## 7. Endpoints / Interfaces
Liste endpoints, comandos, tools MCP, telas ou funções necessárias.

## 8. DTOs / Dados necessários
Liste os campos, payloads, estruturas JSON ou tipos TypeScript necessários.

## 9. Regras de negócio
Liste regras, validações e comportamentos esperados.

## 10. Decisões técnicas
Liste decisões no formato:
- Decidimos usar X porque Y.

## 11. Problemas / riscos
Liste riscos, blockers e pontos de atenção no formato:
- Problema: ...

## 12. Tarefas de implementação
Liste tarefas acionáveis começando com verbos:
- Implementar ...
- Criar ...
- Adicionar ...
- Validar ...
- Testar ...

## 13. Checklist de validação
Liste como validar que está funcionando.

## 14. Próximos passos
Liste a sequência recomendada de execução.

Ideia bruta:
[COLE AQUI]`

          const PROMPT_SHORT = `Transforme a ideia abaixo em um Rayzen Blueprint pronto para importar com \`rayzen_blueprint_import_markdown\`.

Preciso que venha em Markdown com:
Resumo, Problema, Objetivo, Contexto atual, Solução, Arquitetura, Endpoints/Interfaces, Dados/DTOs, Regras, Decisões, Problemas, Tarefas, Checklist e Próximos passos.

Use frases detectáveis pelo parser:
- Decidimos ...
- Problema: ...
- Implementar ...
- Criar ...
- Adicionar ...
- Testar ...

Ideia:
[COLE AQUI]`

          const copy = (key: string, text: string) => {
            navigator.clipboard.writeText(text)
            setBlueprintCopied(key)
            setTimeout(() => setBlueprintCopied(null), 2000)
          }

          return (
            <>
              <div className="fixed inset-0 bg-black/70 z-40" onClick={() => setBlueprintOpen(false)} />
              <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
                <div className="bg-zinc-900 border border-zinc-700 rounded-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto pointer-events-auto shadow-2xl">
                  <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800 sticky top-0 bg-zinc-900">
                    <div className="flex items-center gap-4">
                      <span className="text-zinc-100 font-semibold text-sm">Rayzen Blueprint</span>
                      <div className="flex gap-1">
                        <button
                          onClick={() => setBlueprintTab('templates')}
                          className={`text-xs px-3 py-1 rounded-md transition-colors ${blueprintTab === 'templates' ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'}`}
                        >Templates</button>
                        <button
                          onClick={() => { setBlueprintTab('history'); loadHistory() }}
                          className={`text-xs px-3 py-1 rounded-md transition-colors ${blueprintTab === 'history' ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'}`}
                        >Histórico</button>
                        <button
                          onClick={() => { setBlueprintTab('upload'); setBlueprintUploadPreview(null); setBlueprintUploadResult(null) }}
                          className={`text-xs px-3 py-1 rounded-md transition-colors ${blueprintTab === 'upload' ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'}`}
                        >Upload</button>
                      </div>
                    </div>
                    <button onClick={() => setBlueprintOpen(false)} className="text-zinc-500 hover:text-zinc-300 text-lg leading-none">×</button>
                  </div>

                  <div className="px-5 py-4 space-y-5">
                  {blueprintTab === 'history' && (
                    <div>
                      {!activeProjectId && (
                        <p className="text-zinc-500 text-xs text-center py-6">Selecione um projeto para ver o histórico.</p>
                      )}
                      {activeProjectId && blueprintHistoryLoading && (
                        <p className="text-zinc-500 text-xs text-center py-6 animate-pulse">Carregando...</p>
                      )}
                      {activeProjectId && !blueprintHistoryLoading && blueprintHistory.length === 0 && (
                        <p className="text-zinc-500 text-xs text-center py-6">Nenhum blueprint importado ainda.</p>
                      )}
                      {activeProjectId && !blueprintHistoryLoading && blueprintHistory.length > 0 && (
                        <div className="space-y-2">
                          {blueprintHistory.map((bp) => (
                            <div key={bp.id} className="bg-zinc-800/60 border border-zinc-700 rounded-lg px-4 py-3">
                              <div className="flex items-start justify-between gap-2">
                                <span className="text-zinc-200 text-xs font-medium leading-snug">{bp.title}</span>
                                <span className="text-zinc-600 text-[10px] shrink-0">{new Date(bp.createdAt).toLocaleDateString('pt-BR')}</span>
                              </div>
                              <div className="flex gap-2 mt-1.5 flex-wrap">
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-700 text-zinc-400">{bp.source}</span>
                                {bp.mode && <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-700 text-zinc-400">{bp.mode}</span>}
                                {bp.wikiPages.length > 0 && <span className="text-[10px] text-emerald-500">{bp.wikiPages.length} wiki</span>}
                                {bp.eventCount > 0 && <span className="text-[10px] text-sky-500">{bp.eventCount} eventos</span>}
                                {bp.nextSteps.length > 0 && <span className="text-[10px] text-violet-400">{bp.nextSteps.length} próx. passos</span>}
                                {bp.warnings.length > 0 && <span className="text-[10px] text-amber-400">{bp.warnings.length} avisos</span>}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                  {blueprintTab === 'upload' && (
                    <div className="space-y-4">
                      {/* Drop zone */}
                      <label className="block cursor-pointer">
                        <div
                          className="border-2 border-dashed border-zinc-700 hover:border-sky-500 rounded-xl p-8 text-center transition-colors"
                          onDragOver={(e) => e.preventDefault()}
                          onDrop={(e) => {
                            e.preventDefault()
                            const file = e.dataTransfer.files[0]
                            if (!file) return
                            setBlueprintUploadFileName(file.name)
                            setBlueprintUploadTitle(file.name.replace(/\.md$/i, '').replace(/[-_]/g, ' '))
                            setBlueprintUploadPreview(null)
                            setBlueprintUploadResult(null)
                            const reader = new FileReader()
                            reader.onload = (ev) => setBlueprintUploadContent(ev.target?.result as string ?? '')
                            reader.readAsText(file)
                          }}
                        >
                          {blueprintUploadFileName ? (
                            <div>
                              <p className="text-emerald-400 text-xs font-medium">{blueprintUploadFileName}</p>
                              <p className="text-zinc-600 text-[11px] mt-1">{blueprintUploadContent.length.toLocaleString()} chars</p>
                            </div>
                          ) : (
                            <div>
                              <p className="text-zinc-400 text-xs">Arraste um arquivo <span className="text-sky-400 font-mono">.md</span> aqui</p>
                              <p className="text-zinc-600 text-[11px] mt-1">ou clique para selecionar</p>
                            </div>
                          )}
                        </div>
                        <input
                          type="file"
                          accept=".md,text/markdown"
                          className="hidden"
                          onChange={(e) => {
                            const file = e.target.files?.[0]
                            if (!file) return
                            setBlueprintUploadFileName(file.name)
                            setBlueprintUploadTitle(file.name.replace(/\.md$/i, '').replace(/[-_]/g, ' '))
                            setBlueprintUploadPreview(null)
                            setBlueprintUploadResult(null)
                            const reader = new FileReader()
                            reader.onload = (ev) => setBlueprintUploadContent(ev.target?.result as string ?? '')
                            reader.readAsText(file)
                          }}
                        />
                      </label>

                      {/* Title input */}
                      {blueprintUploadContent && (
                        <div>
                          <label className="text-zinc-400 text-[11px] uppercase tracking-wider block mb-1">Título</label>
                          <input
                            type="text"
                            value={blueprintUploadTitle}
                            onChange={(e) => setBlueprintUploadTitle(e.target.value)}
                            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-100 focus:outline-none focus:border-sky-500"
                            placeholder="Título do blueprint"
                          />
                        </div>
                      )}

                      {/* Preview result */}
                      {blueprintUploadPreview && !blueprintUploadResult && (
                        <div className="bg-zinc-800/60 border border-zinc-700 rounded-lg px-4 py-3 space-y-2">
                          <p className="text-zinc-300 text-[11px] font-semibold uppercase tracking-wider">Preview</p>
                          <div className="text-[11px] text-zinc-400 space-y-1">
                            <p><span className="text-zinc-500">Seções detectadas:</span> {blueprintUploadPreview.detectedSections.join(', ') || '—'}</p>
                            <p><span className="text-zinc-500">Wiki pages:</span> {blueprintUploadPreview.suggestedWikiPages.length}</p>
                            <p><span className="text-zinc-500">Próx. passos:</span> {blueprintUploadPreview.suggestedNextSteps.length}</p>
                            {blueprintUploadPreview.risks.length > 0 && (
                              <p className="text-amber-400">⚠ {blueprintUploadPreview.risks.join(' · ')}</p>
                            )}
                          </div>
                        </div>
                      )}

                      {/* Import result */}
                      {blueprintUploadResult && (
                        <div className={`border rounded-lg px-4 py-3 space-y-1 ${blueprintUploadResult.ok ? 'bg-emerald-950/40 border-emerald-800' : 'bg-red-950/40 border-red-800'}`}>
                          <p className={`text-[11px] font-semibold ${blueprintUploadResult.ok ? 'text-emerald-400' : 'text-red-400'}`}>
                            {blueprintUploadResult.ok ? '✓ Blueprint importado!' : '✗ Erro ao importar'}
                          </p>
                          {blueprintUploadResult.ok && (
                            <div className="text-[11px] text-zinc-400 flex gap-3 flex-wrap">
                              {blueprintUploadResult.created.wikiPages.length > 0 && <span className="text-emerald-500">{blueprintUploadResult.created.wikiPages.length} wiki</span>}
                              {blueprintUploadResult.created.events.length > 0 && <span className="text-sky-400">{blueprintUploadResult.created.events.length} eventos</span>}
                              {blueprintUploadResult.created.nextSteps.length > 0 && <span className="text-violet-400">{blueprintUploadResult.created.nextSteps.length} próx. passos</span>}
                            </div>
                          )}
                          {blueprintUploadResult.warnings.length > 0 && (
                            <p className="text-amber-400 text-[10px]">{blueprintUploadResult.warnings.join(' · ')}</p>
                          )}
                        </div>
                      )}

                      {/* Actions */}
                      {blueprintUploadContent && !blueprintUploadResult && (
                        <div className="flex gap-2">
                          <button
                            disabled={blueprintUploadLoading || !blueprintUploadTitle.trim()}
                            onClick={async () => {
                              if (!activeProjectId) return
                              setBlueprintUploadLoading(true)
                              try {
                                const res = await fetch(`${API_URL}/blueprint/preview`, {
                                  method: 'POST',
                                  headers: { ...authHeaders(), 'Content-Type': 'application/json' },
                                  body: JSON.stringify({ projectId: activeProjectId, title: blueprintUploadTitle, content: blueprintUploadContent, format: 'markdown' }),
                                })
                                if (res.ok) setBlueprintUploadPreview(await res.json())
                              } finally {
                                setBlueprintUploadLoading(false)
                              }
                            }}
                            className="flex-1 text-xs px-3 py-2 rounded-lg border border-zinc-700 hover:border-emerald-500 hover:text-emerald-400 text-zinc-400 transition-colors disabled:opacity-40"
                          >
                            {blueprintUploadLoading ? 'Analisando...' : 'Preview'}
                          </button>
                          <button
                            disabled={blueprintUploadLoading || !blueprintUploadTitle.trim() || !activeProjectId}
                            onClick={async () => {
                              if (!activeProjectId) return
                              setBlueprintUploadLoading(true)
                              try {
                                const res = await fetch(`${API_URL}/blueprint/import`, {
                                  method: 'POST',
                                  headers: { ...authHeaders(), 'Content-Type': 'application/json' },
                                  body: JSON.stringify({ projectId: activeProjectId, title: blueprintUploadTitle, content: blueprintUploadContent, format: 'markdown', source: 'manual' }),
                                })
                                if (res.ok) setBlueprintUploadResult(await res.json())
                              } finally {
                                setBlueprintUploadLoading(false)
                              }
                            }}
                            className="flex-1 text-xs px-3 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 text-white font-medium transition-colors disabled:opacity-40"
                          >
                            {blueprintUploadLoading ? 'Importando...' : 'Importar'}
                          </button>
                        </div>
                      )}

                      {!activeProjectId && (
                        <p className="text-amber-400 text-[11px] text-center">Selecione um projeto antes de importar.</p>
                      )}
                    </div>
                  )}
                  {blueprintTab === 'templates' && <>
                    {/* Fluxo */}
                    <div className="bg-zinc-800/50 rounded-lg px-4 py-3 text-xs text-zinc-400 leading-relaxed font-mono">
                      Ideia bruta → ChatGPT/Claude <span className="text-zinc-600 mx-1">→</span> Blueprint Markdown <span className="text-zinc-600 mx-1">→</span> <span className="text-emerald-400">rayzen_blueprint_preview</span> <span className="text-zinc-600 mx-1">→</span> <span className="text-sky-400">rayzen_blueprint_import_markdown</span>
                    </div>

                    {/* Template completo */}
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-zinc-300 text-xs font-semibold uppercase tracking-wider">Prompt completo (14 seções)</span>
                        <button
                          onClick={() => copy('full', PROMPT_FULL)}
                          className="text-xs px-3 py-1 rounded-md border border-zinc-700 hover:border-sky-500 hover:text-sky-400 text-zinc-400 transition-colors"
                        >
                          {blueprintCopied === 'full' ? '✓ copiado' : 'copiar'}
                        </button>
                      </div>
                      <pre className="bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-3 text-[11px] text-zinc-500 overflow-x-auto whitespace-pre-wrap leading-relaxed max-h-48 overflow-y-auto">
                        {PROMPT_FULL}
                      </pre>
                    </div>

                    {/* Template curto */}
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-zinc-300 text-xs font-semibold uppercase tracking-wider">Prompt curto (uso diário)</span>
                        <button
                          onClick={() => copy('short', PROMPT_SHORT)}
                          className="text-xs px-3 py-1 rounded-md border border-zinc-700 hover:border-sky-500 hover:text-sky-400 text-zinc-400 transition-colors"
                        >
                          {blueprintCopied === 'short' ? '✓ copiado' : 'copiar'}
                        </button>
                      </div>
                      <pre className="bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-3 text-[11px] text-zinc-500 overflow-x-auto whitespace-pre-wrap leading-relaxed max-h-32 overflow-y-auto">
                        {PROMPT_SHORT}
                      </pre>
                    </div>

                    {/* O que o parser detecta */}
                    <div>
                      <span className="text-zinc-300 text-xs font-semibold uppercase tracking-wider block mb-2">O que o parser detecta</span>
                      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
                        {[
                          ['- Implementar / Criar / Adicionar ...', 'nextSteps + backlog'],
                          ['- Decidimos / Optamos / Aprovado ...', 'evento decision'],
                          ['- Problema: / Blocker: / Issue: ...', 'evento problem'],
                          ['## Seção / ### Subseção', 'página Wiki separada'],
                        ].map(([pattern, result]) => (
                          <div key={pattern} className="flex gap-2 items-start">
                            <span className="text-zinc-600 font-mono shrink-0">{pattern}</span>
                            <span className="text-zinc-500">→ {result}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Comando Claude Code */}
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-zinc-300 text-xs font-semibold uppercase tracking-wider">Comando para o Claude Code</span>
                        <button
                          onClick={() => copy('cmd', 'Use rayzen_blueprint_preview com este Markdown e me mostre o que será criado antes de importar.\n\ntitle: "[TÍTULO]"\nmarkdown: """\n[MARKDOWN AQUI]\n"""')}
                          className="text-xs px-3 py-1 rounded-md border border-zinc-700 hover:border-sky-500 hover:text-sky-400 text-zinc-400 transition-colors"
                        >
                          {blueprintCopied === 'cmd' ? '✓ copiado' : 'copiar'}
                        </button>
                      </div>
                      <pre className="bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-3 text-[11px] text-zinc-500 whitespace-pre-wrap leading-relaxed">
{`Use rayzen_blueprint_preview com este Markdown e me mostre o que será criado antes de importar.

title: "[TÍTULO]"
markdown: """
[MARKDOWN AQUI]
"""

→ Se correto: Use rayzen_blueprint_import_markdown para importar.`}
                      </pre>
                    </div>
                  </>}
                  </div>
                </div>
              </div>
            </>
          )
        })()}

        {/* Help panel */}
        {helpOpen && (
          <div className="max-w-3xl mx-auto mb-3">
            <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-4 text-xs">
              <div className="flex items-center justify-between mb-3">
                <span className="text-zinc-300 font-semibold text-[11px] uppercase tracking-wider">Comandos rápidos</span>
                <button onClick={() => setHelpOpen(false)} className="text-zinc-600 hover:text-zinc-400 text-base leading-none">×</button>
              </div>
              {activeProjectId && (() => {
                const resumeKit = `rayzen_get_resume(projectId: ${activeProjectId})\nrayzen_get_goal(projectId: ${activeProjectId})`
                return (
                  <div className="mb-3 border-b border-zinc-800 pb-3">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-zinc-400 text-[10px] uppercase tracking-wider">🔄 Retomar em nova sessão (Claude Code)</span>
                      <button
                        type="button"
                        onClick={() => {
                          void navigator.clipboard?.writeText(resumeKit)
                          setResumeCopied(true)
                          setTimeout(() => setResumeCopied(false), 1500)
                        }}
                        className="hud-btn text-[10px] px-2 py-0.5"
                      >
                        {resumeCopied ? 'copiado ✓' : 'copiar'}
                      </button>
                    </div>
                    <pre className="text-zinc-400 bg-zinc-950 rounded-lg p-2 text-[10px] whitespace-pre-wrap break-all font-mono">{resumeKit}</pre>
                  </div>
                )
              })()}
              <div className="grid grid-cols-2 gap-x-6 gap-y-1">
                {([
                  { label: '📁 Novo projeto completo', cmd: 'crie o projeto |nome| brief:\n|descreva a ideia aqui|' },
                  { label: '📁 Novo projeto simples', cmd: 'crie o projeto |nome|' },
                  { label: '🧪 Rodar testes', cmd: 'rode os testes do projeto |nome|' },
                  { label: '📸 Capturar falhas', cmd: 'capture as falhas do projeto |nome|' },
                  { label: '🖥️ Info do sistema', cmd: 'qual o status do PC' },
                  { label: '📸 Screenshot', cmd: 'tira um screenshot: |descrição do teste|' },
                  { label: '📂 Git status', cmd: 'git status do projeto |nome|' },
                  { label: '📋 Git log', cmd: 'quais os commits recentes do projeto |nome|' },
                  { label: '🔄 Reiniciar API', cmd: 'restart api' },
                  { label: '🐳 Status Docker', cmd: 'lista os containers docker' },
                  { label: '📧 Ler emails', cmd: 'leia meus emails' },
                  { label: '🗂️ Organizar downloads', cmd: 'organiza meus downloads' },
                ] as { label: string; cmd: string }[]).map(({ label, cmd }) => (
                  <button
                    key={label}
                    onClick={() => {
                      setInput(cmd.replace(/\|/g, ''))
                      setHelpOpen(false)
                      requestAnimationFrame(() => inputRef.current?.focus())
                    }}
                    className="text-left text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 px-2 py-1.5 rounded-lg transition-colors truncate"
                    title={cmd.replace(/\|/g, '')}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <p className="text-zinc-600 text-[10px] mt-3 border-t border-zinc-800 pt-2">
                Clique para preencher o input. Edite os campos antes de enviar.
              </p>
            </div>
          </div>
        )}
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
            className="hud-input flex-1 px-4 py-3 disabled:opacity-50"
          />
          <button
            type="button"
            onClick={() => setBlueprintOpen(v => !v)}
            title="Blueprint — templates de planejamento"
            className={`hud-btn px-3 py-3 text-xs font-bold transition-colors ${blueprintOpen ? 'text-sky-300 bg-zinc-700' : 'text-zinc-500 hover:text-sky-400'}`}
          >
            BP
          </button>
          <button
            type="button"
            onClick={() => setHelpOpen(v => !v)}
            title="Comandos rápidos"
            className={`hud-btn px-3 py-3 text-sm font-bold transition-colors ${helpOpen ? 'text-zinc-100 bg-zinc-700' : 'text-zinc-500 hover:text-zinc-300'}`}
          >
            ?
          </button>
          <button
            type="button"
            onClick={toggleRecording}
            disabled={loading || transcribing}
            title={recording ? 'Parar gravação' : transcribing ? 'Transcrevendo…' : 'Gravar áudio'}
            className={`hud-btn ${
              recording
                ? 'hud-btn-danger px-4 py-3'
                : transcribing
                ? 'px-4 py-3 opacity-60'
                : 'px-4 py-3'
            }`}
            style={recording ? {animation:'hud-pulse-red 1s ease-in-out infinite'} : undefined}
          >
            {recording ? '⏹' : transcribing ? '…' : '🎤'}
          </button>
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="hud-btn hud-btn-primary px-5 py-3"
          >
            Enviar
          </button>
        </form>
      </div>
      {/* QA Dashboard panel */}
      {qaOpen && (
        <div className="fixed inset-0 z-[55] flex items-center justify-center">
          <div className="fixed inset-0 bg-black/80" onClick={() => setQaOpen(false)} />
          <div className="relative z-[55] w-full max-w-2xl bg-zinc-900 border border-zinc-800 rounded-2xl mx-4 max-h-[88vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
              <div className="flex items-center gap-4">
                <h2 className="text-sm font-semibold">QA Dashboard</h2>
                <div className="flex gap-1">
                  {([
                    ['resumo', 'resumo'],
                    ['tendencia', 'tendência'],
                    ['historico', 'histórico'],
                    ['qualidade', 'qualidade'],
                    ['catalogo', 'catálogo'],
                  ] as const).map(([t, label]) => (
                    <button
                      key={t}
                      onClick={() => switchQATab(t)}
                      className={`text-xs px-2.5 py-1 rounded-lg transition-colors ${qaTab === t ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <button onClick={() => setQaOpen(false)} className="text-zinc-500 hover:text-zinc-300 text-xs">fechar</button>
            </div>

            <div className="overflow-y-auto flex-1 px-6 py-5">
              {/* ── Aba: Resumo ────────────────────────────────────────── */}
              {qaTab === 'resumo' && (
                <div className="space-y-5">
                  {qaLoading && <p className="text-zinc-500 text-xs text-center py-10">Carregando…</p>}
                  {!qaLoading && !qaSummary && (
                    <p className="text-zinc-500 text-xs text-center py-10">Nenhum run encontrado para este projeto.</p>
                  )}
                  {qaSummary && (
                    <>
                      {/* Último run */}
                      {qaSummary.lastRun ? (
                        <div className="bg-zinc-800 rounded-xl p-4">
                          <div className="flex items-center justify-between mb-3">
                            <span className="text-xs text-zinc-400">Último run · <span className="font-mono">{qaSummary.lastRun.tool}</span></span>
                            <span className="text-xs text-zinc-500">{new Date(qaSummary.lastRun.date).toLocaleString('pt-BR')}</span>
                          </div>
                          <div className="flex gap-4">
                            <div className="text-center">
                              <div className="text-2xl font-bold text-emerald-400">{qaSummary.lastRun.passed}</div>
                              <div className="text-[10px] text-zinc-500 mt-0.5">passou</div>
                            </div>
                            <div className="text-center">
                              <div className="text-2xl font-bold text-red-400">{qaSummary.lastRun.failed}</div>
                              <div className="text-[10px] text-zinc-500 mt-0.5">falhou</div>
                            </div>
                            <div className="text-center">
                              <div className="text-2xl font-bold text-zinc-400">{qaSummary.lastRun.total}</div>
                              <div className="text-[10px] text-zinc-500 mt-0.5">total</div>
                            </div>
                            <div className="text-center ml-auto">
                              <div className={`text-2xl font-bold ${qaSummary.lastRun.passRate >= 80 ? 'text-emerald-400' : qaSummary.lastRun.passRate >= 60 ? 'text-amber-400' : 'text-red-400'}`}>
                                {qaSummary.lastRun.passRate}%
                              </div>
                              <div className="text-[10px] text-zinc-500 mt-0.5">pass rate</div>
                            </div>
                          </div>
                          {/* Barra de progresso */}
                          <div className="mt-3 h-1.5 bg-zinc-700 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all ${qaSummary.lastRun.passRate >= 80 ? 'bg-emerald-500' : qaSummary.lastRun.passRate >= 60 ? 'bg-amber-500' : 'bg-red-500'}`}
                              style={{ width: `${qaSummary.lastRun.passRate}%` }}
                            />
                          </div>
                        </div>
                      ) : (
                        <p className="text-zinc-500 text-xs text-center py-6">Nenhum run registrado ainda.</p>
                      )}

                      {/* Top falhas */}
                      {qaSummary.topFailures.length > 0 && (
                        <div>
                          <h3 className="text-xs font-semibold text-zinc-400 mb-2">Top falhas recorrentes</h3>
                          <div className="space-y-1.5">
                            {qaSummary.topFailures.map((f, i) => (
                              <div key={i} className="flex items-start gap-3 bg-zinc-800/60 rounded-lg px-3 py-2">
                                <span className="text-xs text-red-400 font-mono mt-0.5 shrink-0">{f.count}×</span>
                                <div className="min-w-0">
                                  <p className="text-xs text-zinc-200 truncate font-mono">{f.test}</p>
                                  {f.messages[0] && <p className="text-[10px] text-zinc-500 truncate mt-0.5">{f.messages[0]}</p>}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Flaky tests */}
                      {qaSummary.flakyTests.length > 0 && (
                        <div>
                          <h3 className="text-xs font-semibold text-zinc-400 mb-2">Testes instáveis (flaky)</h3>
                          <div className="space-y-1.5">
                            {qaSummary.flakyTests.map((f, i) => (
                              <div key={i} className="flex items-center gap-3 bg-zinc-800/60 rounded-lg px-3 py-2">
                                <span className="text-xs text-amber-400 font-mono shrink-0">{f.failRate}%</span>
                                <p className="text-xs text-zinc-200 truncate font-mono">{f.test}</p>
                                <span className="text-[10px] text-zinc-600 shrink-0 ml-auto">{f.failedIn}/{f.totalRuns} runs</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

              {/* ── Aba: Tendência ─────────────────────────────────────── */}
              {qaTab === 'tendencia' && (
                <div className="space-y-4">
                  {qaTrendLoading && <p className="text-zinc-500 text-xs text-center py-10">Carregando…</p>}
                  {!qaTrendLoading && qaTrend.length === 0 && (
                    <p className="text-zinc-500 text-xs text-center py-10">Sem dados de tendência ainda.</p>
                  )}
                  {qaTrend.length > 0 && (
                    <>
                      <p className="text-xs text-zinc-500">Pass rate por dia — últimos 30 dias</p>
                      {/* Mini bar chart via SVG */}
                      <div className="bg-zinc-800 rounded-xl p-4">
                        <svg viewBox={`0 0 ${qaTrend.length * 18} 80`} className="w-full h-20">
                          {qaTrend.map((pt, i) => {
                            const barH = Math.max(2, (pt.passRate / 100) * 64)
                            const color = pt.passRate >= 80 ? '#34d399' : pt.passRate >= 60 ? '#fbbf24' : '#f87171'
                            return (
                              <g key={i}>
                                <rect x={i * 18 + 2} y={66 - barH} width={14} height={barH} fill={color} rx={2} opacity={0.85} />
                                <title>{pt.date}: {pt.passRate}% ({pt.failed} falhas)</title>
                              </g>
                            )
                          })}
                          {/* Linha de 80% */}
                          <line x1={0} y1={14.4} x2={qaTrend.length * 18} y2={14.4} stroke="#3f3f46" strokeWidth={1} strokeDasharray="3,3" />
                        </svg>
                        <div className="flex justify-between mt-1">
                          <span className="text-[10px] text-zinc-600">{qaTrend[0]?.date}</span>
                          <span className="text-[10px] text-zinc-500">80% ·· meta</span>
                          <span className="text-[10px] text-zinc-600">{qaTrend[qaTrend.length - 1]?.date}</span>
                        </div>
                      </div>
                      {/* Tabela resumida */}
                      <div className="space-y-1">
                        {[...qaTrend].reverse().slice(0, 10).map((pt, i) => (
                          <div key={i} className="flex items-center gap-3 text-xs">
                            <span className="text-zinc-500 font-mono w-24 shrink-0">{pt.date}</span>
                            <div className="flex-1 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full ${pt.passRate >= 80 ? 'bg-emerald-500' : pt.passRate >= 60 ? 'bg-amber-500' : 'bg-red-500'}`}
                                style={{ width: `${pt.passRate}%` }}
                              />
                            </div>
                            <span className={`w-10 text-right shrink-0 ${pt.passRate >= 80 ? 'text-emerald-400' : pt.passRate >= 60 ? 'text-amber-400' : 'text-red-400'}`}>{pt.passRate}%</span>
                            <span className="text-zinc-600 w-16 text-right shrink-0">{pt.failed} falha{pt.failed !== 1 ? 's' : ''}</span>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* ── Aba: Histórico ─────────────────────────────────────── */}
              {qaTab === 'historico' && (
                <div className="space-y-2">
                  {qaRunsLoading && <p className="text-zinc-500 text-xs text-center py-10">Carregando…</p>}
                  {!qaRunsLoading && qaRuns.length === 0 && (
                    <p className="text-zinc-500 text-xs text-center py-10">Nenhum run registrado ainda.</p>
                  )}
                  {qaRuns.map(run => {
                    const passRate = run.totalTests > 0 ? Math.round((run.passed / run.totalTests) * 100) : 0
                    return (
                      <div key={run.id} className={`bg-zinc-800/60 rounded-xl px-4 py-3 ${qaRunDetail?.id === run.id ? 'ring-1 ring-cyan-500/50' : ''}`}>
                        <div className="flex items-center justify-between mb-1.5">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-mono text-zinc-300">{run.tool}</span>
                            {run.branch && <span className="text-[10px] text-zinc-500 font-mono">· {run.branch}</span>}
                            {run.source === 'ci' && <span className="text-[10px] bg-blue-900/60 text-blue-300 px-1.5 py-0.5 rounded">CI</span>}
                          </div>
                          <span className="text-[10px] text-zinc-600">{new Date(run.executedAt).toLocaleString('pt-BR')}</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-xs text-emerald-400">{run.passed} ok</span>
                          <span className="text-xs text-red-400">{run.failed} fail</span>
                          <span className="text-xs text-zinc-500">{run.skipped} skip</span>
                          <div className="flex-1 h-1 bg-zinc-700 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full ${passRate >= 80 ? 'bg-emerald-500' : passRate >= 60 ? 'bg-amber-500' : 'bg-red-500'}`}
                              style={{ width: `${passRate}%` }}
                            />
                          </div>
                          <span className={`text-xs font-mono ${passRate >= 80 ? 'text-emerald-400' : passRate >= 60 ? 'text-amber-400' : 'text-red-400'}`}>{passRate}%</span>
                          {run.durationMs > 0 && <span className="text-[10px] text-zinc-600">{(run.durationMs / 1000).toFixed(1)}s</span>}
                          <button onClick={() => void selectQARun(run)} className="text-[10px] text-cyan-400 hover:text-cyan-300">detalhes</button>
                        </div>
                      </div>
                    )
                  })}
                  {qaRunDetailLoading && <p className="text-zinc-500 text-xs text-center py-4">Carregando detalhe do run...</p>}
                  {qaRunDetail && (
                    <div className="mt-4 rounded-xl border border-cyan-900/50 bg-cyan-950/10 p-4 space-y-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <h3 className="text-xs font-semibold text-cyan-300">Detalhe do TestRun {qaRunDetail.id.slice(0, 8)}</h3>
                          <p className="text-[10px] text-zinc-500">{qaRunDetail.tool} - {new Date(qaRunDetail.executedAt).toLocaleString('pt-BR')}</p>
                        </div>
                        <span className={`text-sm font-mono ${qaRunDetail.passRate >= 80 ? 'text-emerald-400' : qaRunDetail.passRate >= 60 ? 'text-amber-400' : 'text-red-400'}`}>{qaRunDetail.passRate}%</span>
                      </div>

                      <div>
                        <h4 className="text-[10px] uppercase tracking-[0.16em] text-zinc-500 mb-2">Evidencias vinculadas</h4>
                        {qaRunDetail.evidence.length === 0 ? (
                          <p className="text-xs text-zinc-500">Nenhuma evidencia vinculada a este run.</p>
                        ) : (
                          <div className="grid gap-3 sm:grid-cols-2">
                            {qaRunDetail.evidence.map(item => (
                              <a
                                key={item.id}
                                href={item.remotePath ? `${API_URL}/evidence/file/${item.remotePath.replace(/\\/g, '/')}` : "#"}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="rounded-lg border border-zinc-800 bg-zinc-950/60 overflow-hidden hover:border-cyan-800 transition-colors"
                              >
                                {item.remotePath && (
                                  <img src={`${API_URL}/evidence/file/${item.remotePath.replace(/\\/g, '/')}`} alt={item.description ?? 'Evidencia do TestRun'} className="h-28 w-full object-cover border-b border-zinc-800" />
                                )}
                                <div className="p-2">
                                  <p className="text-xs text-zinc-200 line-clamp-2">{item.description ?? item.content}</p>
                                  <p className="text-[10px] text-zinc-600 mt-1">{new Date(item.takenAt ?? item.createdAt).toLocaleString('pt-BR')}</p>
                                </div>
                              </a>
                            ))}
                          </div>
                        )}
                      </div>

                      <div>
                        <h4 className="text-[10px] uppercase tracking-[0.16em] text-zinc-500 mb-2">Falhas</h4>
                        {qaRunDetail.failedCases.length === 0 ? (
                          <p className="text-xs text-emerald-400">Nenhuma falha registrada neste run.</p>
                        ) : (
                          <div className="space-y-2">
                            {qaRunDetail.failedCases.slice(0, 5).map((failure, i) => (
                              <div key={i} className="rounded-lg bg-zinc-950/60 border border-zinc-800 p-3">
                                <p className="text-xs text-zinc-200 font-mono">{failure.suite} &gt; {failure.name}</p>
                                {failure.message && <p className="text-[10px] text-red-300 mt-1 line-clamp-2">{failure.message}</p>}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* ── Aba: Qualidade de Dados ────────────────────────────── */}
              {qaTab === 'qualidade' && (
                <div className="space-y-4">
                  {dqLoading && <p className="text-zinc-500 text-xs text-center py-10">Carregando…</p>}
                  {!dqLoading && !dqSummary && (
                    <p className="text-zinc-500 text-xs text-center py-10">Nenhuma regra de qualidade cadastrada.</p>
                  )}
                  {dqSummary && (
                    <>
                      {/* Totais */}
                      <div className="grid grid-cols-4 gap-3">
                        {[
                          { label: 'score médio', value: dqSummary.avgScore !== null ? `${dqSummary.avgScore}%` : '—', color: dqSummary.avgScore !== null ? (dqSummary.avgScore >= 80 ? 'text-emerald-400' : dqSummary.avgScore >= 60 ? 'text-amber-400' : 'text-red-400') : 'text-zinc-500' },
                          { label: 'regras ativas', value: dqSummary.totalRules, color: 'text-zinc-200' },
                          { label: 'falhando', value: dqSummary.totalFailing, color: dqSummary.totalFailing > 0 ? 'text-red-400' : 'text-zinc-500' },
                          { label: 'sem execução', value: dqSummary.totalNotRun, color: dqSummary.totalNotRun > 0 ? 'text-amber-400' : 'text-zinc-500' },
                        ].map(({ label, value, color }) => (
                          <div key={label} className="bg-zinc-800 rounded-xl p-3 text-center">
                            <div className={`text-xl font-bold ${color}`}>{value}</div>
                            <div className="text-[10px] text-zinc-500 mt-0.5">{label}</div>
                          </div>
                        ))}
                      </div>

                      {/* Por dataset */}
                      {dqSummary.datasets.length === 0 && (
                        <p className="text-zinc-500 text-xs text-center py-4">Nenhum dataset com regras.</p>
                      )}
                      {dqSummary.datasets.map((ds) => (
                        <div key={ds.dataset} className="bg-zinc-800/60 border border-zinc-700 rounded-xl p-4 space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-medium text-zinc-200 font-mono">{ds.dataset}</span>
                            <div className="flex items-center gap-2">
                              {ds.failing > 0 && <span className="text-[10px] text-red-400">{ds.failing} falha{ds.failing !== 1 ? 's' : ''}</span>}
                              {ds.notRun > 0 && <span className="text-[10px] text-amber-400">{ds.notRun} sem run</span>}
                              <span className={`text-sm font-bold ${ds.score !== null ? (ds.score >= 80 ? 'text-emerald-400' : ds.score >= 60 ? 'text-amber-400' : 'text-red-400') : 'text-zinc-500'}`}>
                                {ds.score !== null ? `${ds.score}%` : '—'}
                              </span>
                            </div>
                          </div>
                          {ds.score !== null && (
                            <div className="h-1.5 bg-zinc-700 rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full ${ds.score >= 80 ? 'bg-emerald-500' : ds.score >= 60 ? 'bg-amber-500' : 'bg-red-500'}`}
                                style={{ width: `${ds.score}%` }}
                              />
                            </div>
                          )}
                          <div className="flex flex-wrap gap-1.5 pt-1">
                            {ds.detail.map((r) => (
                              <span
                                key={r.ruleId}
                                title={`${r.ruleType}${r.field ? ` · ${r.field}` : ''} · ${r.severity}`}
                                className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${r.status === 'passed' ? 'bg-emerald-900/50 text-emerald-400' : r.status === 'failed' ? 'bg-red-900/50 text-red-400' : 'bg-zinc-700 text-zinc-500'}`}
                              >
                                {r.ruleType}{r.field ? `:${r.field}` : ''}
                              </span>
                            ))}
                          </div>
                        </div>
                      ))}
                    </>
                  )}
                </div>
              )}

              {/* ── Aba: Catálogo de Dados ──────────────────────────────── */}
              {qaTab === 'catalogo' && (
                <div className="space-y-3">
                  {catalogLoading && <p className="text-zinc-500 text-xs text-center py-10">Carregando…</p>}
                  {!catalogLoading && catalogAssets.length === 0 && (
                    <p className="text-zinc-500 text-xs text-center py-10">Nenhum data asset cadastrado.</p>
                  )}
                  {catalogAssets.map((asset) => (
                    <div key={asset.id} className="bg-zinc-800/60 border border-zinc-700 rounded-xl px-4 py-3">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <span className="text-xs font-medium text-zinc-200">{asset.name}</span>
                          {asset.description && (
                            <p className="text-[11px] text-zinc-500 mt-0.5">{asset.description}</p>
                          )}
                        </div>
                        <span className="text-[10px] text-zinc-600 shrink-0">{new Date(asset.createdAt).toLocaleDateString('pt-BR')}</span>
                      </div>
                      <div className="flex gap-1.5 mt-2 flex-wrap">
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-700 text-zinc-400 font-mono">{asset.type}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded ${asset.sensitivity === 'critical' ? 'bg-red-900/50 text-red-400' : asset.sensitivity === 'high' ? 'bg-orange-900/50 text-orange-400' : asset.sensitivity === 'medium' ? 'bg-amber-900/50 text-amber-400' : 'bg-zinc-700 text-zinc-500'}`}>
                          {asset.sensitivity}
                        </span>
                        {asset.containsPII && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-900/50 text-purple-400">PII</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Evidence modal */}
      {evidenceOpen && (
        <div className="fixed inset-0 z-[55] flex items-center justify-center">
          <div className="fixed inset-0 bg-black/80" onClick={() => setEvidenceOpen(false)} />
          <div className="relative z-[55] w-full max-w-4xl bg-zinc-900 border border-zinc-800 rounded-2xl mx-4 max-h-[88vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
              <div>
                <h2 className="text-sm font-semibold">Evidencias</h2>
                <p className="text-xs text-zinc-500">Capturas visuais associadas ao projeto ativo.</p>
              </div>
              <div className="flex items-center gap-2">
                {(['all', 'with_run', 'without_run'] as const).map(filter => (
                  <button
                    key={filter}
                    onClick={() => setEvidenceFilter(filter)}
                    className={`text-[10px] px-2 py-1 rounded-lg transition-colors ${evidenceFilter === filter ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'}`}
                  >
                    {filter === 'all' ? 'todas' : filter === 'with_run' ? 'com TestRun' : 'sem TestRun'}
                  </button>
                ))}
                <button onClick={() => void loadEvidence()} className="text-zinc-500 hover:text-zinc-300 text-xs">atualizar</button>
                <button onClick={() => setEvidenceOpen(false)} className="text-zinc-500 hover:text-zinc-300 text-xs">fechar</button>
              </div>
            </div>
            <div className="p-6 overflow-y-auto">
              {evidenceLoading && <p className="text-zinc-500 text-xs text-center py-10">Carregando...</p>}
              {!evidenceLoading && evidenceItems.length === 0 && (
                <p className="text-zinc-500 text-xs text-center py-10">Nenhuma evidencia registrada ainda.</p>
              )}
              {!evidenceLoading && evidenceItems.length > 0 && (() => {
                const filtered = evidenceItems.filter(item =>
                  evidenceFilter === 'all' ? true : evidenceFilter === 'with_run' ? Boolean(item.testRunId) : !item.testRunId,
                )
                const grouped = filtered.reduce<Record<string, EvidenceItem[]>>((acc, item) => {
                  const key = item.testRunId ? `TestRun ${item.testRunId.slice(0, 8)}` : 'Sem TestRun vinculado'
                  acc[key] = [...(acc[key] ?? []), item]
                  return acc
                }, {})
                const entries = Object.entries(grouped)
                return entries.length === 0 ? (
                  <p className="text-zinc-500 text-xs text-center py-10">Nenhuma evidencia neste filtro.</p>
                ) : (
                  <div className="space-y-6">
                    {entries.map(([group, items]) => (
                      <section key={group} className="space-y-3">
                        <div className="flex items-center justify-between">
                          <h3 className="text-xs font-semibold text-zinc-400">{group}</h3>
                          <span className="text-[10px] text-zinc-600">{items.length} evidencia{items.length !== 1 ? 's' : ''}</span>
                        </div>
                        <div className="grid gap-4 sm:grid-cols-2">
                          {items.map((item) => (
                            <div key={item.id} className="rounded-xl border border-zinc-800 bg-zinc-950/60 overflow-hidden">
                              {item.remotePath ? (
                                <img
                                  src={`${API_URL}/evidence/file/${item.remotePath.replace(/\\/g, '/')}`}
                                  alt={item.prompt ? `Evidencia: ${item.prompt}` : 'Screenshot do projeto'}
                                  className="w-full h-48 object-cover border-b border-zinc-800"
                                />
                              ) : (
                                <div className="h-48 flex items-center justify-center text-xs text-zinc-600 border-b border-zinc-800">
                                  arquivo local ainda n?o sincronizado
                                </div>
                              )}
                              <div className="p-3 space-y-2">
                                <div className="flex items-center justify-between gap-2">
                                  <div className="flex items-center gap-1.5">
                                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-900 text-cyan-300">screenshot</span>
                                    {item.category && item.category !== 'general' && (
                                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300">
                                        {item.category}
                                      </span>
                                    )}
                                    {item.testRunId && (
                                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-900 text-emerald-300" title={item.testRunId}>
                                        test run {item.testRunId.slice(0, 8)}
                                      </span>
                                    )}
                                  </div>
                                  <span className="text-[10px] text-zinc-600">
                                    {new Date(item.takenAt ?? item.createdAt).toLocaleString('pt-BR')}
                                  </span>
                                </div>
                                {item.description
                                  ? <p className="text-xs text-zinc-200 line-clamp-2">{item.description}</p>
                                  : item.prompt && <p className="text-xs text-zinc-300 line-clamp-2">{item.prompt}</p>}
                                {item.localPath && (
                                  <p className="text-[10px] font-mono text-zinc-600 truncate" title={item.localPath}>{item.localPath}</p>
                                )}
                                <div className="flex items-center justify-end gap-2 pt-1">
                                  {item.remotePath && (
                                    <a
                                      href={`${API_URL}/evidence/file/${item.remotePath.replace(/\\/g, '/')}`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="text-[10px] text-cyan-400 hover:text-cyan-300"
                                    >
                                      abrir
                                    </a>
                                  )}
                                  <button
                                    onClick={() => void deleteEvidence(item.id)}
                                    disabled={deletingEvidenceId === item.id}
                                    className="text-[10px] text-red-400 hover:text-red-300 disabled:opacity-40"
                                  >
                                    {deletingEvidenceId === item.id ? 'excluindo...' : 'excluir'}
                                  </button>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </section>
                    ))}
                  </div>
                )
              })()}
            </div>
          </div>
        </div>
      )}

      {/* Goal Graph panel */}
      {graphOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="fixed inset-0 bg-black/70" onClick={() => setGraphOpen(false)} />
          <div className="hud-surface relative w-full max-w-3xl max-h-[90vh] flex flex-col mx-4">
            <div className="flex items-center justify-between px-6 py-4" style={{borderBottom:'1px solid var(--hud-border)'}}>
              <div className="flex items-center gap-4">
                <span className="hud-title text-sm">GOAL GRAPH</span>
                <div className="flex gap-1">
                  {(['estado', 'goal', 'eventos', 'universe'] as const).map(m => (
                    <button key={m} onClick={() => {
                      setGraphSubMode(m)
                      if (m === 'eventos' && !graphEventData) loadEventGraph()
                      if (m === 'universe' && !universeData) loadUniverse()
                    }}
                      className={`hud-nav ${graphSubMode === m ? 'active' : ''}`}>
                      {m === 'goal' ? 'Goal Graph' : m === 'eventos' ? 'Eventos' : m === 'universe' ? 'Universe' : 'Estado atual'}
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
                      className="hud-btn shrink-0"
                    >
                      {graphStateRefreshing ? 'Analisando…' : '⟳ gerar estado'}
                    </button>
                  </div>
                  <div className="rounded-xl overflow-hidden border border-zinc-800">
                    <GraphCanvas
                      key={`state-${graphStateData?.updatedAt ?? 'empty'}-${graphStateData?.graphLinks?.length ?? 0}`}
                      mode="estado"
                      milestones={graphStateData?.milestones ?? []}
                      blockers={graphStateData?.blockers ?? []}
                      nextSteps={graphStateData?.nextSteps ?? []}
                      graphLinks={graphStateData?.graphLinks ?? []}
                      goal={graphGoalData?.goal ? { id: graphGoalData.goal.id, title: graphGoalData.goal.title } : null}
                      onSave={async (patch) => {
                        const res = await fetch(`${API_URL}/projects/${activeProjectId}/state/planning`, {
                          method: 'PATCH',
                          headers: authHeaders({ 'Content-Type': 'application/json' }),
                          body: JSON.stringify(patch),
                        }).catch(() => null)
                        if (res && 'ok' in res && res.ok) setGraphStateData(await res.json() as ProjectState)
                      }}
                    />
                  </div>
                </>
              ) : graphSubMode === 'universe' ? (
                <>
                  <p className="text-xs text-zinc-500 mb-2">Universe — canvas livre: crie, conecte e organize o conhecimento do projeto.</p>
                  {universeLoading ? (
                    <div className="text-zinc-500 text-sm text-center py-8">Carregando universe…</div>
                  ) : activeProjectId ? (
                    <UniverseCanvas
                      projectId={activeProjectId}
                      initialNodes={universeData?.nodes ?? []}
                      initialEdges={universeData?.edges ?? []}
                      onSave={saveUniverse}
                      onImport={importUniverse}
                      saving={universeSaving}
                      importing={universeImporting}
                    />
                  ) : null}
                </>
              ) : graphGoalData ? (
                <>
                  {graphGoalData.goal ? (
                    <>
                      {/* Goal card */}
                      <div className="hud-card p-4 space-y-2">
                        <div className="flex items-start justify-between gap-2">
                          <span className="text-sm font-semibold text-zinc-200 leading-snug">🎯 {graphGoalData.goal.title}</span>
                          <div className="flex items-center gap-2 shrink-0">
                            {graphGoalData.goal.targetDate && (
                              <span className="text-xs text-zinc-500">{new Date(graphGoalData.goal.targetDate).toLocaleDateString('pt-BR')}</span>
                            )}
                            <button
                              onClick={() => openEditGoalForm(graphGoalData.goal!)}
                              className="text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded-lg bg-blue-500/10 border border-blue-500/30 text-blue-300 hover:bg-blue-500/20 transition-colors"
                            >
                              editar meta
                            </button>
                            <button
                              onClick={() => achieveGoal(graphGoalData.goal!.id)}
                              title="Marcar como conquistada"
                              className="text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20 transition-colors"
                            >
                              conquistar
                            </button>
                            <button
                              onClick={() => deleteGoal(graphGoalData.goal!.id)}
                              className="text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded-lg bg-red-500/10 border border-red-500/30 text-red-300 hover:bg-red-500/20 transition-colors"
                            >
                              excluir meta
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
                                <span className={c.done ? 'text-emerald-400' : 'text-zinc-600'}>{c.done ? '✓' : '○'}</span>
                                <span className={c.done ? 'line-through text-zinc-600' : ''}>{c.text.replace(/◈/g, '◆')}</span>
                              </button>
                            ))}
                          </div>
                        )}

                        <div className="flex flex-wrap items-center gap-2 pt-1">
                          <button
                            onClick={() => {
                              const text = prompt('Novo critério')
                              if (!text?.trim()) return
                              saveCriteria(graphGoalData.goal!.id, [...graphGoalData.goal!.successCriteria, { id: `c-${Date.now()}`, text: text.trim(), done: false }])
                            }}
                            className="text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors"
                          >
                            + critério
                          </button>
                          {graphGoalData.goal.successCriteria.map(c => (
                            <span key={c.id} className="inline-flex items-center gap-1 text-[10px] text-zinc-600">
                              {c.text.slice(0, 24)}
                              <button onClick={() => {
                                const text = prompt('Editar critério', c.text)
                                if (!text?.trim()) return
                                saveCriteria(graphGoalData.goal!.id, graphGoalData.goal!.successCriteria.map(x => x.id === c.id ? { ...x, text: text.trim() } : x))
                              }} className="hover:text-zinc-300">editar</button>
                              <button onClick={() => {
                                if (!confirm('Excluir este critério?')) return
                                saveCriteria(graphGoalData.goal!.id, graphGoalData.goal!.successCriteria.filter(x => x.id !== c.id))
                              }} className="hover:text-red-400">excluir</button>
                            </span>
                          ))}
                        </div>

                        <div className="pt-1">
                          <button
                            onClick={() => {
                              const metric = prompt('Métrica do KPI')
                              if (!metric?.trim()) return
                              const target = prompt('Meta do KPI')
                              if (!target?.trim()) return
                              const unit = prompt('Unidade do KPI', '') ?? ''
                              saveGoalKpis(graphGoalData.goal!.id, [...graphGoalData.goal!.kpis, { metric: metric.trim(), target: target.trim(), unit }])
                            }}
                            className="text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors"
                          >
                            + KPI
                          </button>
                        </div>

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
                                      <button onClick={() => {
                                        const metric = prompt('Métrica do KPI', k.metric)
                                        if (!metric?.trim()) return
                                        const target = prompt('Meta do KPI', k.target)
                                        if (!target?.trim()) return
                                        const unit = prompt('Unidade do KPI', k.unit ?? '') ?? ''
                                        saveGoalKpis(graphGoalData.goal!.id, graphGoalData.goal!.kpis.map(x => x.metric === k.metric ? { ...x, metric: metric.trim(), target: target.trim(), unit } : x))
                                      }} className="text-[10px] text-zinc-600 hover:text-zinc-300">editar</button>
                                      <button onClick={() => {
                                        if (!confirm('Excluir este KPI?')) return
                                        saveGoalKpis(graphGoalData.goal!.id, graphGoalData.goal!.kpis.filter(x => x.metric !== k.metric))
                                      }} className="text-[10px] text-zinc-600 hover:text-red-400">excluir</button>
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
                      <button onClick={openCreateGoalForm}
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
                <button onClick={openCreateGoalForm}
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
          <div className="fixed inset-0 bg-black/80" onClick={() => { setGoalFormOpen(false); resetGoalForm() }} />
          <div className="relative bg-zinc-900 border border-zinc-700 rounded-2xl w-full max-w-lg max-h-[85vh] flex flex-col shadow-2xl mx-4">
            <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
              <span className="text-sm font-semibold text-zinc-200">{editingGoalId ? 'Editar meta do projeto' : 'Definir meta do projeto'}</span>
              <button onClick={() => { setGoalFormOpen(false); resetGoalForm() }} className="text-zinc-500 hover:text-zinc-300 text-lg">×</button>
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
              <button onClick={() => { setGoalFormOpen(false); resetGoalForm() }} className="text-xs text-zinc-500 hover:text-zinc-300 px-3 py-2">Cancelar</button>
              <button onClick={saveGoal} disabled={savingGoal || !goalTitle.trim()}
                className="bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-xs px-4 py-2 rounded-lg transition-colors">
                {savingGoal ? 'Salvando…' : editingGoalId ? 'Salvar edição' : 'Salvar meta'}
              </button>
            </div>
          </div>
        </div>
      )}

    </main>
  )
}
