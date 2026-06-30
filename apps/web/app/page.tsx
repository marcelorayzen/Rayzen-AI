'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { API_URL } from '../lib/api-url'
import { authHeaders, TOKEN_KEY } from '../lib/api-client'
import { useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'
import { useProjects, type Project, type ImportTab } from './hooks/useProjects'
import { useMemory, type MemoryDoc } from './hooks/useMemory'
import { useGoalGraph, type ProjectState, type PlanningNode } from './hooks/useGoalGraph'
import { useChatStream, type Message, type Session, type WorkMode } from './hooks/useChatStream'
import { useQA } from './hooks/useQA'
import { useMissions } from './hooks/useMissions'
import { HelpTip } from './components/HelpTip'
import { VersionsModal } from './components/VersionsModal'
import { HealthModal } from './components/HealthModal'
import { CostsModal } from './components/CostsModal'
import { RecommendationsModal } from './components/RecommendationsModal'
import { GitContextModal } from './components/GitContextModal'
import { QuickCaptureModal } from './components/QuickCaptureModal'
import { SynthesisModal } from './components/SynthesisModal'
import { EvidenceModal } from './components/EvidenceModal'
import { ProjectStateModal } from './components/ProjectStateModal'
import { ActivityModal } from './components/ActivityModal'
import { DocumentationModal } from './components/DocumentationModal'
import { MemoryPanel } from './components/MemoryPanel'
import { ImportModal } from './components/ImportModal'
import { SidebarOverlay } from './components/SidebarOverlay'
import { NewProjectWizard } from './components/NewProjectWizard'
import { MissionsModal } from './components/MissionsModal'
import { QADashboardPanel } from './components/QADashboardPanel'
import { GoalGraphPanel } from './components/GoalGraphPanel'
import { GoalFormModal } from './components/GoalFormModal'
import { Header } from './components/Header'
import { MessagesList } from './components/MessagesList'
import { InputBar } from './components/InputBar'
const RayzenConstellation = dynamic(() => import('./components/RayzenConstellation').then(m => ({ default: m.RayzenConstellation })), { ssr: false })

export interface ActivityEvent {
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

export interface ProjectDoc {
  id: string
  type: string
  content: string
  generatedAt: string
  reviewedAt: string | null
}

export interface EvidenceItem {
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

export function memoryGroupFor(doc: MemoryDoc): { key: string; label: string } {
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

export type MemoryDocType = 'code' | 'config' | 'doc' | 'qa' | 'catalog' | 'notion' | 'github' | 'url' | 'memory' | 'other'

// Extrai nome do projeto a partir do caminho no filesystem (ex: .../Projects/rayzen-ai/...)
export function projectLabelFromPath(path: string | null): string | null {
  if (!path) return null
  const m = path.replace(/\\/g, '/').match(/\/Projects\/([^/]+)\//i)
  return m ? m[1] : null
}

// Extrai caminho relativo dentro do projeto (ex: apps/api/src/modules/memory/)
export function relativePathFromFull(path: string | null): string | null {
  if (!path) return null
  const norm = path.replace(/\\/g, '/')
  const m = norm.match(/\/Projects\/[^/]+\/(.+)/)
  if (!m) return null
  const parts = m[1].split('/')
  parts.pop() // remove filename
  return parts.join('/') || null
}

export function memoryDocType(sourcePath: string | null, metadata?: Record<string, unknown> | null): MemoryDocType {
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

export const DOC_TYPE_LABELS: Record<MemoryDocType, string> = {
  code: 'Código', config: 'Config', doc: 'Doc', qa: 'QA',
  catalog: 'Catálogo', notion: 'Notion', github: 'GitHub',
  url: 'URL', memory: 'Memória', other: 'Outro',
}

export const DOC_TYPE_COLORS: Record<MemoryDocType, string> = {
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
export const PROJECT_COLORS = [
  'bg-indigo-500/20 text-indigo-300',
  'bg-emerald-500/20 text-emerald-300',
  'bg-rose-500/20 text-rose-300',
  'bg-amber-500/20 text-amber-300',
  'bg-sky-500/20 text-sky-300',
  'bg-violet-500/20 text-violet-300',
]

export const RISK_COLORS: Record<string, string> = {
  low: 'bg-emerald-500',
  medium: 'bg-amber-500',
  high: 'bg-red-500',
}

export const STAGE_LABELS: Record<string, string> = {
  discovery: 'Descoberta', building: 'Em construção', stabilizing: 'Estabilizando',
  maintaining: 'Manutenção', paused: 'Pausado',
}

export interface SynthesisArtifact {
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

export interface HealthBreakdown {
  activity: number
  documentation: number
  consistency: number
  nextSteps: number
  blockers: number
  focus: number
}

export interface HealthScore {
  id: string
  score: number
  breakdown: HealthBreakdown
  createdAt: string
}

export interface HealthData {
  current: HealthScore | null
  history: HealthScore[]
}

export interface CostModuleRow { module: string; model: string; tokens: number; messages: number; costUSD: number }
export interface CostProjectRow { projectId: string | null; projectName: string | null; tokens: number; costUSD: number }
export interface CostSummary {
  period: string
  totals: { tokens: number; messages: number; costUSD: number }
  byModule: CostModuleRow[]
  byProject: CostProjectRow[]
  pricing: Record<string, number>
}

export interface GitContext {
  branches: Record<string, number>
  recentCommits: Array<{ hash: string; message: string; branch: string; ts: string }>
  mostTouchedFiles: Array<{ file: string; count: number }>
  lastBranch: string | null
  lastCommitHash: string | null
  lastCommitMessage: string | null
  totalGitEvents: number
}

export type QuickCaptureIntent = 'decision' | 'idea' | 'problem' | 'reference'
export type MemoryClassFilter = 'all' | 'global' | 'inbox' | 'working' | 'consolidated' | 'archive'

export interface Recommendation {
  id: string
  type: string
  title: string
  description: string
  priority: 'low' | 'medium' | 'high'
  action: string | null
  computedAt: string
}

export interface DocVersion {
  id: string
  content: string
  diff: string | null
  reason: string
  sourceIds: string[]
  createdAt: string
}

export function planningTitle(item: string | PlanningNode) {
  return typeof item === 'string' ? item : item.title
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
    pendingGates: missionPendingGates,
    gateActionLoading: missionGateActionLoading,
    approveGate: approveMissionGate,
    rejectGate: rejectMissionGate,
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
  const [agentOnline, setAgentOnline] = useState<boolean | null>(null)
  const [costsOpen, setCostsOpen] = useState(false)
  const [costsPeriod, setCostsPeriod] = useState<'today'|'week'|'month'|'all'>('month')
  const [costsData, setCostsData] = useState<CostSummary | null>(null)
  const [costsLoading, setCostsLoading] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)

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

  useEffect(() => {
    const check = async () => {
      try {
        const res = await fetch(`${API_URL}/infra/health`)
        if (res.ok) {
          const data = await res.json() as { services?: { agent_desktop?: { ok: boolean } } }
          setAgentOnline(data.services?.agent_desktop?.ok ?? null)
        }
      } catch { /* silencioso */ }
    }
    void check()
    const id = setInterval(check, 30_000)
    return () => clearInterval(id)
  }, [])

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
      const raw = await res.json() as Record<string, unknown>
      const artifact = { ...raw, content: raw['content'] ?? raw['synthesis'] } as SynthesisArtifact
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
        const raw = await res.json() as Record<string, unknown>
        const artifact = { ...raw, content: raw['content'] ?? raw['synthesis'] } as SynthesisArtifact
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

  return (
    <main className="h-screen overflow-hidden flex flex-col">
      <RayzenConstellation />
      <div className="hud-scanline" aria-hidden="true" />

      {/* Document versions modal */}
      {versionsOpen && (
        <VersionsModal
          versions={versions}
          versionsLoading={versionsLoading}
          expandedVersion={expandedVersion}
          onToggleExpand={(id) => setExpandedVersion(expandedVersion === id ? null : id)}
          onClose={() => setVersionsOpen(false)}
        />
      )}

      {/* New project wizard */}
      {newProjectOpen && (
        <NewProjectWizard
          onboardStep={onboardStep}
          closeNewProject={closeNewProject}
          newProjectName={newProjectName}
          setNewProjectName={setNewProjectName}
          newProjectSlug={newProjectSlug}
          setNewProjectSlug={setNewProjectSlug}
          newProjectDesc={newProjectDesc}
          setNewProjectDesc={setNewProjectDesc}
          createProject={createProject}
          creatingProject={creatingProject}
          onboardSrcTab={onboardSrcTab}
          setOnboardSrcTab={setOnboardSrcTab}
          githubUser={githubUser}
          setGithubUser={setGithubUser}
          githubRepo={githubRepo}
          setGithubRepo={setGithubRepo}
          githubToken={githubToken}
          setGithubToken={setGithubToken}
          notionToken={notionToken}
          setNotionToken={setNotionToken}
          notionPageId={notionPageId}
          setNotionPageId={setNotionPageId}
          onboardIndexSource={onboardIndexSource}
          onboardIndexing={onboardIndexing}
          onboardIndexResult={onboardIndexResult}
          setOnboardStep={setOnboardStep}
          onboardGoalTitle={onboardGoalTitle}
          setOnboardGoalTitle={setOnboardGoalTitle}
          onboardGoalDate={onboardGoalDate}
          setOnboardGoalDate={setOnboardGoalDate}
          onboardGoalCriteria={onboardGoalCriteria}
          setOnboardGoalCriteria={setOnboardGoalCriteria}
          onboardCreateGoal={onboardCreateGoal}
          onboardSavingGoal={onboardSavingGoal}
        />
      )}

      {/* Health score modal */}
      {healthOpen && healthData && (
        <HealthModal healthData={healthData} onClose={() => setHealthOpen(false)} />
      )}

      {/* Missions modal (V2) */}
      {missionsOpen && (
        <MissionsModal
          missions={missions}
          missionsLoading={missionsLoading}
          selectedMission={selectedMission}
          setSelectedMission={setSelectedMission}
          missionDetailLoading={missionDetailLoading}
          missionInput={missionInput}
          setMissionInput={setMissionInput}
          missionCreating={missionCreating}
          missionExecuting={missionExecuting}
          missionApplyingTemplate={missionApplyingTemplate}
          missionRouteNote={missionRouteNote}
          pendingGates={missionPendingGates}
          gateActionLoading={missionGateActionLoading}
          selectMission={selectMission}
          createMission={createMission}
          executeMission={executeMission}
          applyMissionTemplate={applyMissionTemplate}
          approveGate={approveMissionGate}
          rejectGate={rejectMissionGate}
          onClose={() => setMissionsOpen(false)}
          onOpenDocs={openDocs}
        />
      )}

      {/* Costs modal */}
      {costsOpen && (
        <CostsModal
          costsPeriod={costsPeriod}
          costsData={costsData}
          costsLoading={costsLoading}
          activeProjectId={activeProjectId}
          onPeriodChange={(p) => { setCostsPeriod(p); loadCosts(p, activeProjectId ?? undefined) }}
          onClose={() => setCostsOpen(false)}
        />
      )}

      {/* Recommendations modal */}
      {recsOpen && (
        <RecommendationsModal
          recommendations={recommendations}
          recsLoading={recsLoading}
          dismissing={dismissing}
          onDismiss={dismissRec}
          onClose={() => setRecsOpen(false)}
        />
      )}

      {/* Git context modal */}
      {gitOpen && gitContext && (
        <GitContextModal gitContext={gitContext} onClose={() => setGitOpen(false)} />
      )}

      {/* Project State modal */}
      {stateOpen && projectState && (
        <ProjectStateModal
          projectState={projectState}
          stateRefreshing={stateRefreshing}
          onRefresh={refreshProjectState}
          onClose={() => setStateOpen(false)}
        />
      )}

      {/* Quick capture modal */}
      {quickCaptureOpen && (
        <QuickCaptureModal
          quickCaptureIntent={quickCaptureIntent}
          quickCaptureText={quickCaptureText}
          quickCaptureSaving={quickCaptureSaving}
          onIntentChange={setQuickCaptureIntent}
          onTextChange={setQuickCaptureText}
          onSubmit={submitQuickCapture}
          onClose={() => { setQuickCaptureOpen(false); setQuickCaptureText('') }}
        />
      )}

      {/* Activity modal */}
      {activityOpen && (
        <ActivityModal
          activeProjectId={activeProjectId}
          projects={projects}
          hookHealth={hookHealth}
          memoryClassFilter={memoryClassFilter}
          onFilterChange={(cls) => { setMemoryClassFilter(cls); loadActivityEvents(cls) }}
          highSignalOnly={highSignalOnly}
          onToggleHighSignal={() => setHighSignalOnly(v => !v)}
          activityLoading={activityLoading}
          activityEvents={activityEvents}
          onClose={() => setActivityOpen(false)}
        />
      )}

      {/* Documentation modal */}
      {docsOpen && (
        <DocumentationModal
          projectDocs={projectDocs}
          docsLoading={docsLoading}
          activeDocType={activeDocType}
          onActiveDocTypeChange={setActiveDocType}
          generatingDocs={generatingDocs}
          onGenerateAll={generateAllDocs}
          syncing={syncing}
          onSyncObsidian={syncObsidian}
          notionSyncing={notionSyncing}
          onSyncNotion={syncNotion}
          activeProjectId={activeProjectId}
          syncResult={syncResult}
          notionSyncResult={notionSyncResult}
          onDismissNotionResult={() => setNotionSyncResult(null)}
          onOpenVersions={openVersions}
          onClose={() => { setDocsOpen(false); setSyncResult(null); setNotionSyncResult(null) }}
        />
      )}

      {/* Synthesis modal */}
      {synthesisOpen && (
        <SynthesisModal
          synthesisArtifacts={synthesisArtifacts}
          synthesisLoading={synthesisLoading}
          synthesizing={synthesizing}
          onSynthesizeCurrent={synthesizeCurrent}
          onClose={() => setSynthesisOpen(false)}
        />
      )}

      {/* Memory panel */}
      {memoryOpen && (
        <MemoryPanel
          activeProjectId={activeProjectId}
          projects={projects}
          memoryDocsLoading={memoryDocsLoading}
          memoryDocs={memoryDocs}
          setMemoryDocs={setMemoryDocs}
          memorySearch={memorySearch}
          setMemorySearch={setMemorySearch}
          handleMemorySearch={handleMemorySearch}
          memorySearching={memorySearching}
          memorySearchResults={memorySearchResults}
          setMemorySearchResults={setMemorySearchResults}
          memoryListFilter={memoryListFilter}
          setMemoryListFilter={setMemoryListFilter}
          onClose={() => setMemoryOpen(false)}
        />
      )}

      {/* Import modal */}
      {importOpen && (
        <ImportModal
          importTab={importTab}
          setImportTab={setImportTab}
          importResult={importResult}
          setImportResult={setImportResult}
          importLoading={importLoading}
          githubUser={githubUser}
          setGithubUser={setGithubUser}
          githubRepo={githubRepo}
          setGithubRepo={setGithubRepo}
          githubToken={githubToken}
          setGithubToken={setGithubToken}
          handleImportGithub={handleImportGithub}
          notionToken={notionToken}
          setNotionToken={setNotionToken}
          notionPageId={notionPageId}
          setNotionPageId={setNotionPageId}
          handleImportNotion={handleImportNotion}
          handleImportFile={handleImportFile}
          importUrl={importUrl}
          setImportUrl={setImportUrl}
          handleImportUrl={handleImportUrl}
          onClose={() => { setImportOpen(false); setImportResult(null) }}
        />
      )}

      {/* Sidebar overlay */}
      {sidebarOpen && (
        <SidebarOverlay
          sessions={sessions}
          sessionId={sessionId}
          loadingSession={loadingSession}
          deletingSession={deletingSession}
          newChat={newChat}
          loadSession={loadSession}
          deleteSession={deleteSession}
          onClose={() => setSidebarOpen(false)}
        />
      )}

      {/* Header */}
      <Header
        openSidebar={openSidebar}
        onOpenSettings={() => router.push('/settings')}
        openMemoryPanel={openMemoryPanel}
        setImportOpen={setImportOpen}
        setImportResult={setImportResult}
        sessionId={sessionId}
        activeProjectId={activeProjectId}
        setActiveProjectId={setActiveProjectId}
        projects={projects}
        setNewProjectOpen={setNewProjectOpen}
        renameProject={renameProject}
        deleteProject={deleteProject}
        workMode={workMode}
        setWorkMode={setWorkMode}
        projectState={projectState}
        setStateOpen={setStateOpen}
        loadProjectState={loadProjectState}
        healthData={healthData}
        agentOnline={agentOnline}
        setHealthOpen={setHealthOpen}
        setCostsOpen={setCostsOpen}
        loadCosts={loadCosts}
        costsPeriod={costsPeriod}
        gitContext={gitContext}
        setGitOpen={setGitOpen}
        recommendations={recommendations}
        openRecommendations={openRecommendations}
        setQuickCaptureOpen={setQuickCaptureOpen}
        doCheckpoint={doCheckpoint}
        checkpointing={checkpointing}
        openActivity={openActivity}
        openMissions={openMissions}
        openGraph={openGraph}
        qaSummary={qaSummary}
        openQA={openQA}
        openEvidence={openEvidence}
        autoVoice={autoVoice}
        setAutoVoice={setAutoVoice}
        openSynthesis={openSynthesis}
        openDocs={openDocs}
        onLogout={() => {
          document.cookie = 'rayzen_token=; path=/; max-age=0'
          localStorage.removeItem(TOKEN_KEY)
          router.push('/login')
        }}
        sessionTokens={sessionTokens}
        dailyTokens={dailyTokens}
      />

      {/* Messages */}
      <MessagesList
        messagesContainerRef={messagesContainerRef}
        shouldAutoScrollRef={shouldAutoScrollRef}
        bottomRef={bottomRef}
        messages={messages}
        activeProjectId={activeProjectId}
        loading={loading}
        playingIndex={playingIndex}
        workMode={workMode}
        sendMessage={sendMessage}
        playAudio={playAudio}
      />

      {/* Input */}
      <InputBar
        activeProjectId={activeProjectId}
        blueprintOpen={blueprintOpen}
        setBlueprintOpen={setBlueprintOpen}
        blueprintTab={blueprintTab}
        setBlueprintTab={setBlueprintTab}
        blueprintCopied={blueprintCopied}
        setBlueprintCopied={setBlueprintCopied}
        blueprintHistory={blueprintHistory}
        setBlueprintHistory={setBlueprintHistory}
        blueprintHistoryLoading={blueprintHistoryLoading}
        setBlueprintHistoryLoading={setBlueprintHistoryLoading}
        blueprintUploadFileName={blueprintUploadFileName}
        setBlueprintUploadFileName={setBlueprintUploadFileName}
        blueprintUploadTitle={blueprintUploadTitle}
        setBlueprintUploadTitle={setBlueprintUploadTitle}
        blueprintUploadContent={blueprintUploadContent}
        setBlueprintUploadContent={setBlueprintUploadContent}
        blueprintUploadPreview={blueprintUploadPreview}
        setBlueprintUploadPreview={setBlueprintUploadPreview}
        blueprintUploadResult={blueprintUploadResult}
        setBlueprintUploadResult={setBlueprintUploadResult}
        blueprintUploadLoading={blueprintUploadLoading}
        setBlueprintUploadLoading={setBlueprintUploadLoading}
        helpOpen={helpOpen}
        setHelpOpen={setHelpOpen}
        setInput={setInput}
        inputRef={inputRef}
        input={input}
        loading={loading}
        handleSubmit={handleSubmit}
        submitCurrentInput={submitCurrentInput}
        recording={recording}
        transcribing={transcribing}
        toggleRecording={toggleRecording}
      />
      {/* QA Dashboard panel */}
      {qaOpen && (
        <QADashboardPanel
          qaTab={qaTab}
          switchQATab={switchQATab}
          qaSummary={qaSummary}
          qaLoading={qaLoading}
          qaTrend={qaTrend}
          qaTrendLoading={qaTrendLoading}
          qaRuns={qaRuns}
          qaRunsLoading={qaRunsLoading}
          qaRunDetail={qaRunDetail}
          qaRunDetailLoading={qaRunDetailLoading}
          selectQARun={selectQARun}
          dqSummary={dqSummary}
          dqLoading={dqLoading}
          catalogAssets={catalogAssets}
          catalogLoading={catalogLoading}
          onClose={() => setQaOpen(false)}
        />
      )}

      {/* Evidence modal */}
      {evidenceOpen && (
        <EvidenceModal
          evidenceItems={evidenceItems}
          evidenceLoading={evidenceLoading}
          evidenceFilter={evidenceFilter}
          deletingEvidenceId={deletingEvidenceId}
          onFilterChange={setEvidenceFilter}
          onRefresh={() => void loadEvidence()}
          onDelete={(id) => void deleteEvidence(id)}
          onClose={() => setEvidenceOpen(false)}
        />
      )}

      {graphOpen && (
        <GoalGraphPanel
          graphSubMode={graphSubMode}
          setGraphSubMode={setGraphSubMode}
          graphLoading={graphLoading}
          graphEventData={graphEventData}
          graphEventLoading={graphEventLoading}
          loadEventGraph={loadEventGraph}
          graphStateData={graphStateData}
          setGraphStateData={setGraphStateData}
          graphStateRefreshing={graphStateRefreshing}
          refreshGraphState={refreshGraphState}
          graphGoalData={graphGoalData}
          activeProjectId={activeProjectId}
          universeData={universeData}
          universeLoading={universeLoading}
          universeSaving={universeSaving}
          universeImporting={universeImporting}
          loadUniverse={loadUniverse}
          saveUniverse={saveUniverse}
          importUniverse={importUniverse}
          openEditGoalForm={openEditGoalForm}
          achieveGoal={achieveGoal}
          deleteGoal={deleteGoal}
          toggleCriteria={toggleCriteria}
          saveCriteria={saveCriteria}
          saveGoalKpis={saveGoalKpis}
          autoTrackKpis={autoTrackKpis}
          autoTrackingKpis={autoTrackingKpis}
          editingKpi={editingKpi}
          setEditingKpi={setEditingKpi}
          kpiDraft={kpiDraft}
          setKpiDraft={setKpiDraft}
          saveKpi={saveKpi}
          toggleHistory={toggleHistory}
          historyOpen={historyOpen}
          historyLoading={historyLoading}
          goalsHistory={goalsHistory}
          openCreateGoalForm={openCreateGoalForm}
          openGraph={openGraph}
          onClose={() => setGraphOpen(false)}
        />
      )}

      {goalFormOpen && (
        <GoalFormModal
          editingGoalId={editingGoalId}
          goalTitle={goalTitle}
          setGoalTitle={setGoalTitle}
          goalDesc={goalDesc}
          setGoalDesc={setGoalDesc}
          goalTargetDate={goalTargetDate}
          setGoalTargetDate={setGoalTargetDate}
          goalCriteria={goalCriteria}
          setGoalCriteria={setGoalCriteria}
          goalKpis={goalKpis}
          setGoalKpis={setGoalKpis}
          savingGoal={savingGoal}
          saveGoal={saveGoal}
          onClose={() => { setGoalFormOpen(false); resetGoalForm() }}
        />
      )}

    </main>
  )
}
