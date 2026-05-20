'use client'

import { useState, useCallback } from 'react'
import { API_URL } from '../../lib/api-url'
import { authHeaders } from '../../lib/api-client'

export interface SuccessCriteria { id: string; text: string; done: boolean }
export interface PlanningNode { id: string; title: string; description?: string }
export interface GraphLink { id: string; sourceId: string; targetId: string; label?: string }
export interface GapItem { area: string; description: string; severity: 'high' | 'medium' | 'low'; relatedCriteria?: string }
export interface GapAnalysis { gaps: GapItem[]; nextBestAction: string; goalProgress: number; confidence: 'low' | 'medium' | 'high' }

export interface ProjectState {
  objective: string
  stage: string
  blockers: PlanningNode[]
  recentDecisions: string[]
  nextSteps: PlanningNode[]
  risks: string[]
  docGaps: string[]
  riskLevel: 'low' | 'medium' | 'high'
  milestones: Array<{ id: string; title: string; description?: string; status: 'pending' | 'active' | 'done' }>
  graphLinks: GraphLink[]
  backlog: Array<{ id: string; title: string; priority: 'high' | 'medium' | 'low' }>
  activeFocus: string
  definitionOfDone: string
  updatedAt: string
}

export interface ProjectGoal {
  id: string; title: string; description?: string
  successCriteria: SuccessCriteria[]
  kpis: Array<{ metric: string; target: string; current?: string; unit?: string }>
  status: string; targetDate?: string; createdAt: string
}

export interface GoalGraphData {
  goal: ProjectGoal | null; state: ProjectState | null; mermaid: string
  gapAnalysis: GapAnalysis | null; healthScore: number; updatedAt: string
}

export interface EventGraphData {
  milestones: Array<{ id: string; title: string; status: string }>
  events: Array<{ id: string; content: string; intent: string | null; type: string; source: string; ts: string; milestoneId: string | null }>
}

export interface KnowledgeNode { id: string; type: string; label: string; data: Record<string, unknown> }
export interface KnowledgeEdge { id: string; source: string; target: string; label: string }
export interface KnowledgeGraphData { nodes: KnowledgeNode[]; edges: KnowledgeEdge[] }

export interface UniverseNodeData { label: string; nodeType: string; color?: string; originalId?: string; [key: string]: unknown }
export interface UniverseNode { id: string; type: string; position: { x: number; y: number }; data: UniverseNodeData }
export interface UniverseEdge { id: string; source: string; target: string; label?: string; animated?: boolean; style?: Record<string, unknown> }
export interface UniverseMap { nodes: UniverseNode[]; edges: UniverseEdge[] }

export function useGoalGraph(activeProjectId: string | null) {
  const [graphOpen, setGraphOpen] = useState(false)
  const [graphSubMode, setGraphSubMode] = useState<'estado' | 'goal' | 'eventos' | 'universe'>('estado')
  const [graphStateData, setGraphStateData] = useState<ProjectState | null>(null)
  const [graphGoalData, setGraphGoalData] = useState<GoalGraphData | null>(null)
  const [graphLoading, setGraphLoading] = useState(false)
  const [graphStateRefreshing, setGraphStateRefreshing] = useState(false)
  const [graphEventData, setGraphEventData] = useState<EventGraphData | null>(null)
  const [graphEventLoading, setGraphEventLoading] = useState(false)
  const [knowledgeData, setKnowledgeData] = useState<KnowledgeGraphData | null>(null)
  const [knowledgeLoading, setKnowledgeLoading] = useState(false)
  const [universeData, setUniverseData] = useState<UniverseMap | null>(null)
  const [universeLoading, setUniverseLoading] = useState(false)
  const [universeSaving, setUniverseSaving] = useState(false)
  const [universeImporting, setUniverseImporting] = useState(false)
  const [goalsHistory, setGoalsHistory] = useState<ProjectGoal[] | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [editingKpi, setEditingKpi] = useState<string | null>(null)
  const [kpiDraft, setKpiDraft] = useState('')
  const [autoTrackingKpis, setAutoTrackingKpis] = useState(false)
  const [goalFormOpen, setGoalFormOpen] = useState(false)
  const [editingGoalId, setEditingGoalId] = useState<string | null>(null)
  const [goalTitle, setGoalTitle] = useState('')
  const [goalDesc, setGoalDesc] = useState('')
  const [goalTargetDate, setGoalTargetDate] = useState('')
  const [goalCriteria, setGoalCriteria] = useState<SuccessCriteria[]>([])
  const [goalKpis, setGoalKpis] = useState<Array<{ metric: string; target: string; current?: string; unit: string }>>([])
  const [savingGoal, setSavingGoal] = useState(false)

  const loadKnowledgeGraph = useCallback(async () => {
    if (!activeProjectId) return
    setKnowledgeLoading(true)
    try {
      const res = await fetch(`${API_URL}/projects/${activeProjectId}/graph/knowledge`, { headers: authHeaders() })
      if (res.ok) setKnowledgeData(await res.json() as KnowledgeGraphData)
    } catch { /* silencioso */ }
    finally { setKnowledgeLoading(false) }
  }, [activeProjectId])

  const loadUniverse = useCallback(async () => {
    if (!activeProjectId) return
    setUniverseLoading(true)
    try {
      const res = await fetch(`${API_URL}/projects/${activeProjectId}/graph/universe`, { headers: authHeaders() })
      if (res.ok) setUniverseData(await res.json() as UniverseMap)
    } catch { /* silencioso */ }
    finally { setUniverseLoading(false) }
  }, [activeProjectId])

  const saveUniverse = useCallback(async (nodes: UniverseNode[], edges: UniverseEdge[]) => {
    if (!activeProjectId) return
    setUniverseSaving(true)
    try {
      const res = await fetch(`${API_URL}/projects/${activeProjectId}/graph/universe`, {
        method: 'PUT',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ nodes, edges }),
      })
      if (res.ok) setUniverseData(await res.json() as UniverseMap)
    } catch { /* silencioso */ }
    finally { setUniverseSaving(false) }
  }, [activeProjectId])

  const importUniverse = useCallback(async () => {
    if (!activeProjectId) return
    setUniverseImporting(true)
    try {
      const res = await fetch(`${API_URL}/projects/${activeProjectId}/graph/universe/import`, {
        method: 'POST',
        headers: authHeaders(),
      })
      if (res.ok) setUniverseData(await res.json() as UniverseMap)
    } catch { /* silencioso */ }
    finally { setUniverseImporting(false) }
  }, [activeProjectId])

  const openGraph = useCallback(async (sub: 'estado' | 'goal' | 'eventos' | 'universe' = 'estado') => {
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
      if (stateRes.ok) {
        const data = await stateRes.json() as { state?: ProjectState }
        if (data.state) setGraphStateData(data.state)
      }
      if (goalRes.ok) setGraphGoalData(await goalRes.json() as GoalGraphData)
    } catch { /* silencioso */ }
    finally { setGraphLoading(false) }
    if (sub === 'eventos') {
      setGraphEventLoading(true)
      try {
        const res = await fetch(`${API_URL}/projects/${activeProjectId}/graph/events`, { headers: authHeaders() })
        if (res.ok) setGraphEventData(await res.json() as EventGraphData)
      } catch { /* silencioso */ }
      finally { setGraphEventLoading(false) }
    }
    if (sub === 'universe') {
      await loadUniverse()
    }
  }, [activeProjectId, loadKnowledgeGraph, loadUniverse])

  const refreshGraphState = useCallback(async () => {
    if (!activeProjectId) return
    setGraphStateRefreshing(true)
    try {
      await fetch(`${API_URL}/projects/${activeProjectId}/state/refresh`, { method: 'POST', headers: authHeaders() })
      const res = await fetch(`${API_URL}/projects/${activeProjectId}/graph`, { headers: authHeaders() })
      const data = res.ok ? await res.json() as { state?: ProjectState } : null
      if (data?.state) setGraphStateData(data.state)
    } catch { /* silencioso */ }
    finally { setGraphStateRefreshing(false) }
  }, [activeProjectId])

  const loadEventGraph = useCallback(async () => {
    if (!activeProjectId) return
    setGraphEventLoading(true)
    try {
      const res = await fetch(`${API_URL}/projects/${activeProjectId}/graph/events`, { headers: authHeaders() })
      if (res.ok) setGraphEventData(await res.json() as EventGraphData)
    } catch { /* silencioso */ }
    finally { setGraphEventLoading(false) }
  }, [activeProjectId])

  const resetGoalForm = useCallback(() => {
    setEditingGoalId(null)
    setGoalTitle('')
    setGoalDesc('')
    setGoalTargetDate('')
    setGoalCriteria([])
    setGoalKpis([])
  }, [])

  const openCreateGoalForm = useCallback(() => {
    resetGoalForm()
    setGoalFormOpen(true)
  }, [resetGoalForm])

  const openEditGoalForm = useCallback((goal: ProjectGoal) => {
    setEditingGoalId(goal.id)
    setGoalTitle(goal.title)
    setGoalDesc(goal.description ?? '')
    setGoalTargetDate(goal.targetDate ? goal.targetDate.slice(0, 10) : '')
    setGoalCriteria(goal.successCriteria ?? [])
    setGoalKpis((goal.kpis ?? []).map(k => ({ metric: k.metric, target: k.target, current: k.current, unit: k.unit ?? '' })))
    setGoalFormOpen(true)
  }, [])

  const saveGoal = useCallback(async () => {
    if (!activeProjectId || !goalTitle.trim()) return
    setSavingGoal(true)
    try {
      const url = editingGoalId
        ? `${API_URL}/projects/${activeProjectId}/graph/goal/${editingGoalId}`
        : `${API_URL}/projects/${activeProjectId}/graph/goal`
      const res = await fetch(url, {
        method: editingGoalId ? 'PATCH' : 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ title: goalTitle, description: goalDesc || undefined, successCriteria: goalCriteria, kpis: goalKpis, targetDate: goalTargetDate || undefined }),
      })
      if (res.ok) {
        setGoalFormOpen(false)
        resetGoalForm()
        setGoalsHistory(null)
        await openGraph('goal')
      }
    } catch { /* silencioso */ }
    finally { setSavingGoal(false) }
  }, [activeProjectId, editingGoalId, goalTitle, goalDesc, goalTargetDate, goalCriteria, goalKpis, openGraph, resetGoalForm])

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

  const deleteGoal = useCallback(async (goalId: string) => {
    if (!activeProjectId) return
    if (!confirm('Excluir esta meta inteira? Esta ação não apaga o estado do projeto.')) return
    await fetch(`${API_URL}/projects/${activeProjectId}/graph/goal/${goalId}`, {
      method: 'DELETE',
      headers: authHeaders(),
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

  const saveGoalKpis = useCallback(async (goalId: string, kpis: ProjectGoal['kpis']) => {
    if (!activeProjectId) return
    await fetch(`${API_URL}/projects/${activeProjectId}/graph/goal/${goalId}/kpis`, {
      method: 'PATCH',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ kpis }),
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

  return {
    graphOpen, setGraphOpen,
    graphSubMode, setGraphSubMode,
    graphStateData, setGraphStateData,
    graphGoalData, setGraphGoalData,
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
    historyOpen, setHistoryOpen,
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
  }
}
