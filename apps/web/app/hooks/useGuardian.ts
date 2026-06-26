'use client'

import { useState, useCallback, useEffect } from 'react'
import { V2_URL } from '../../lib/api-url'
import { authHeaders } from '../../lib/api-client'

export interface GuardianReport {
  id:                string
  projectId:         string
  repoPath:          string
  changedFiles:      string[]
  impactedModules:   string[]
  filesWithoutTests: string[]
  suggestedTests:    { file: string; testFile: string; reason: string }[]
  riskScore:         number
  riskLevel:         'low' | 'medium' | 'high' | 'critical'
  deployRecommend:   'safe' | 'review' | 'block'
  summary:           string
  overridden:        boolean
  overrideReason:    string | null
  createdAt:         string
}

export function useGuardian(projectId: string | null) {
  const [latest,    setLatest]    = useState<GuardianReport | null>(null)
  const [history,   setHistory]   = useState<GuardianReport[]>([])
  const [loading,   setLoading]   = useState(false)
  const [error,     setError]     = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!projectId) return
    setLoading(true)
    setError(null)
    try {
      const [latestRes, histRes] = await Promise.all([
        fetch(`${V2_URL}/guardian/latest/${projectId}`, { headers: authHeaders() }),
        fetch(`${V2_URL}/guardian/history/${projectId}`, { headers: authHeaders() }),
      ])
      if (latestRes.status === 200) setLatest(await latestRes.json() as GuardianReport)
      else if (latestRes.status === 404) setLatest(null)
      if (histRes.ok) setHistory(await histRes.json() as GuardianReport[])
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [projectId])

  const override = useCallback(async (id: string, reason: string) => {
    const res = await fetch(`${V2_URL}/guardian/${id}/override`, {
      method:  'PATCH',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body:    JSON.stringify({ reason }),
    })
    if (res.ok) await load()
  }, [load])

  useEffect(() => { void load() }, [load])

  return { latest, history, loading, error, reload: load, override }
}
