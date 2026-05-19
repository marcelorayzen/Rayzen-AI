'use client'

import { useState, useCallback } from 'react'
import { API_URL } from '../../lib/api-url'
import { authHeaders } from '../../lib/api-client'

export interface QARun {
  id: string
  tool: string
  branch: string | null
  commitHash: string | null
  totalTests: number
  passed: number
  failed: number
  skipped: number
  durationMs: number
  source: string
  executedAt: string
}

export interface QARunEvidence {
  id: string
  type: string
  content: string
  remotePath: string | null
  localPath: string | null
  takenAt: string | null
  description: string | null
  category: string | null
  testRunLinkReason: string | null
  createdAt: string
}

export interface QARunDetail extends QARun {
  projectId: string | null
  passRate: number
  suites: unknown[]
  failedCases: Array<{ suite?: string; name?: string; message?: string; stacktrace?: string }>
  evidence: QARunEvidence[]
}

export interface QAFailurePattern {
  test: string
  count: number
  lastSeen: string
  messages: string[]
}

export interface QAFlakyTest {
  test: string
  failRate: number
  failedIn: number
  totalRuns: number
}

export interface QASummary {
  lastRun: {
    date: string
    tool: string
    total: number
    passed: number
    failed: number
    passRate: number
  } | null
  totalRuns: number
  topFailures: QAFailurePattern[]
  flakyTests: QAFlakyTest[]
}

export interface QATrendPoint {
  date: string
  passRate: number
  total: number
  failed: number
}

export type QATab = 'resumo' | 'tendencia' | 'historico'

export function useQA(activeProjectId: string | null) {
  const [qaOpen, setQaOpen]       = useState(false)
  const [qaTab, setQaTab]         = useState<QATab>('resumo')
  const [qaSummary, setQaSummary] = useState<QASummary | null>(null)
  const [qaTrend, setQaTrend]     = useState<QATrendPoint[]>([])
  const [qaRuns, setQaRuns]       = useState<QARun[]>([])
  const [qaRunDetail, setQaRunDetail] = useState<QARunDetail | null>(null)
  const [qaLoading, setQaLoading] = useState(false)
  const [qaTrendLoading, setQATrendLoading] = useState(false)
  const [qaRunsLoading, setQARunsLoading]   = useState(false)
  const [qaRunDetailLoading, setQARunDetailLoading] = useState(false)

  const qs = activeProjectId ? `?project_id=${activeProjectId}` : ''

  const loadSummary = useCallback(async () => {
    setQaLoading(true)
    try {
      const res = await fetch(`${API_URL}/qa/summary${qs}`, { headers: authHeaders() })
      if (res.ok) setQaSummary(await res.json() as QASummary)
    } catch { /* silencioso */ }
    finally { setQaLoading(false) }
  }, [qs])

  const loadTrend = useCallback(async () => {
    setQATrendLoading(true)
    try {
      const res = await fetch(`${API_URL}/qa/trend${qs}&days=30`, { headers: authHeaders() })
      if (res.ok) setQaTrend(await res.json() as QATrendPoint[])
    } catch { /* silencioso */ }
    finally { setQATrendLoading(false) }
  }, [qs])

  const loadRuns = useCallback(async () => {
    setQARunsLoading(true)
    try {
      const res = await fetch(`${API_URL}/qa/reports${qs}&limit=20`, { headers: authHeaders() })
      if (res.ok) setQaRuns(await res.json() as QARun[])
    } catch { /* silencioso */ }
    finally { setQARunsLoading(false) }
  }, [qs])

  const loadRunDetail = useCallback(async (runId: string) => {
    setQARunDetailLoading(true)
    try {
      const res = await fetch(`${API_URL}/qa/reports/${runId}`, { headers: authHeaders() })
      if (res.ok) setQaRunDetail(await res.json() as QARunDetail)
    } catch { /* silencioso */ }
    finally { setQARunDetailLoading(false) }
  }, [])

  const openQA = useCallback(async () => {
    setQaOpen(true)
    setQaTab('resumo')
    await loadSummary()
  }, [loadSummary])

  const switchTab = useCallback(async (tab: QATab) => {
    setQaTab(tab)
    if (tab === 'tendencia' && qaTrend.length === 0) await loadTrend()
    if (tab === 'historico' && qaRuns.length === 0)  await loadRuns()
  }, [qaTrend.length, qaRuns.length, loadTrend, loadRuns])

  const selectRun = useCallback(async (run: QARun) => {
    setQaRunDetail(null)
    await loadRunDetail(run.id)
  }, [loadRunDetail])

  return {
    qaOpen, setQaOpen,
    qaTab, setQaTab,
    qaSummary,
    qaTrend,
    qaRuns,
    qaRunDetail,
    qaLoading,
    qaTrendLoading,
    qaRunsLoading,
    qaRunDetailLoading,
    openQA,
    switchTab,
    loadSummary,
    loadTrend,
    loadRuns,
    loadRunDetail,
    selectRun,
  }
}
