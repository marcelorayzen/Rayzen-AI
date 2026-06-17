'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { V2_URL } from '../../lib/api-url'
import { authHeaders } from '../../lib/api-client'
import { toast } from '../components/toast'

export type MissionStatus = 'pending' | 'active' | 'paused' | 'done' | 'failed' | 'cancelled'
export type StepStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped'

export interface MissionStep {
  id: string
  missionId: string
  title: string
  skillId: string | null
  prompt: string | null
  input: Record<string, unknown>
  output: Record<string, unknown> | null
  executor: string
  dependsOn: string[]
  status: StepStatus
  startedAt: string | null
  completedAt: string | null
  createdAt: string
}

export interface Mission {
  id: string
  projectId: string
  title: string
  objective: string
  context: Record<string, unknown>
  status: MissionStatus
  startedAt: string | null
  completedAt: string | null
  createdAt: string
  steps: MissionStep[]
}

// Resposta do POST /v2/route — IntentContract + `result` (para missões, traz missionId/mission com steps)
interface RouteResponse {
  routeTo: 'mission' | 'skill' | 'ai' | 'clarification'
  confidence: number
  reasoning: string
  result?: { missionId?: string; stepsCount?: number; mission?: Mission; question?: string; note?: string; answer?: string }
}

const ACTIVE: MissionStatus = 'active'

export function useMissions(activeProjectId: string | null) {
  const [missionsOpen, setMissionsOpen] = useState(false)
  const [missions, setMissions] = useState<Mission[]>([])
  const [missionsLoading, setMissionsLoading] = useState(false)
  const [selectedMission, setSelectedMission] = useState<Mission | null>(null)
  const [missionDetailLoading, setMissionDetailLoading] = useState(false)
  const [creating, setCreating] = useState(false)
  const [executing, setExecuting] = useState(false)
  const [applyingTemplate, setApplyingTemplate] = useState(false)
  const [routeNote, setRouteNote] = useState<string | null>(null)

  const selectedIdRef = useRef<string | null>(null)
  selectedIdRef.current = selectedMission?.id ?? null

  const loadMissions = useCallback(async () => {
    if (!activeProjectId) return
    setMissionsLoading(true)
    try {
      const res = await fetch(`${V2_URL}/missions?projectId=${activeProjectId}`, { headers: authHeaders() })
      if (res.ok) setMissions(await res.json() as Mission[])
      else toast.error(`Falha ao carregar missões (HTTP ${res.status})`)
    } catch { toast.error('Falha ao carregar missões — verifique a conexão') }
    finally { setMissionsLoading(false) }
  }, [activeProjectId])

  const loadMissionDetail = useCallback(async (id: string, opts?: { silent?: boolean }) => {
    if (!opts?.silent) setMissionDetailLoading(true)
    try {
      const res = await fetch(`${V2_URL}/missions/${id}`, { headers: authHeaders() })
      if (res.ok) setSelectedMission(await res.json() as Mission)
    } catch { /* silencioso */ }
    finally { if (!opts?.silent) setMissionDetailLoading(false) }
  }, [])

  const selectMission = useCallback(async (id: string) => {
    setSelectedMission(null)
    await loadMissionDetail(id)
  }, [loadMissionDetail])

  const openMissions = useCallback(async () => {
    setMissionsOpen(true)
    setSelectedMission(null)
    setRouteNote(null)
    await loadMissions()
  }, [loadMissions])

  // Cria missão via Router (POST /v2/route, mode:'mission' → LLM planeja os steps)
  const createMission = useCallback(async (content: string) => {
    if (!activeProjectId || !content.trim()) return
    setCreating(true)
    setRouteNote(null)
    try {
      const res = await fetch(`${V2_URL}/route`, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ content: content.trim(), projectId: activeProjectId, mode: 'mission' }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => null) as { message?: string } | null
        const msg = err?.message ?? `HTTP ${res.status}`
        setRouteNote(msg)
        toast.error(`Não foi possível criar a missão: ${msg}`)
        return
      }
      const data = await res.json() as RouteResponse
      await loadMissions()
      const newId = data.result?.missionId
      if (newId) await loadMissionDetail(newId)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'falha ao criar missão'
      setRouteNote(msg)
      toast.error(msg)
    } finally { setCreating(false) }
  }, [activeProjectId, loadMissions, loadMissionDetail])

  // Aplica um template de steps pré-definido (fallback quando /route retorna 0 steps)
  const applyTemplate = useCallback(async (id: string, templateType: string) => {
    setApplyingTemplate(true)
    setRouteNote(null)
    try {
      const res = await fetch(`${V2_URL}/workflows/missions/${id}/template`, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ templateType }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => null) as { message?: string } | null
        setRouteNote(err?.message ?? `HTTP ${res.status}`)
        return
      }
      await loadMissionDetail(id)
      await loadMissions()
    } catch (e) {
      setRouteNote(e instanceof Error ? e.message : 'falha ao aplicar template')
    } finally { setApplyingTemplate(false) }
  }, [loadMissionDetail, loadMissions])

  // Executa o Workflow DAG real (steps skill via SkillEngine, steps ai via Specialist)
  const executeMission = useCallback(async (id: string) => {
    if (!activeProjectId) return
    setExecuting(true)
    try {
      const res = await fetch(`${V2_URL}/workflows/missions/${id}/execute`, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ projectId: activeProjectId }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => null) as { message?: string } | null
        const msg = err?.message ?? `Execução falhou (HTTP ${res.status})`
        setRouteNote(msg)
        toast.error(msg)
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'falha ao executar missão'
      setRouteNote(msg)
      toast.error(msg)
    } finally {
      setExecuting(false)
      await loadMissionDetail(id, { silent: true })
      await loadMissions()
    }
  }, [activeProjectId, loadMissionDetail, loadMissions])

  // Polling: enquanto a missão aberta estiver ativa, acompanha os steps ao vivo
  useEffect(() => {
    if (!missionsOpen || selectedMission?.status !== ACTIVE) return
    const id = selectedMission.id
    const t = setInterval(() => {
      void loadMissionDetail(id, { silent: true })
    }, 3000)
    return () => clearInterval(t)
  }, [missionsOpen, selectedMission?.status, selectedMission?.id, loadMissionDetail])

  return {
    missionsOpen, setMissionsOpen,
    missions,
    missionsLoading,
    selectedMission, setSelectedMission,
    missionDetailLoading,
    creating,
    executing,
    applyingTemplate,
    routeNote,
    openMissions,
    loadMissions,
    selectMission,
    createMission,
    executeMission,
    applyTemplate,
  }
}
