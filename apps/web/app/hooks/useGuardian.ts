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

// Gates de aprovação sem missionId (criados direto pelo GuardianService quando risco >= medium)
// nunca aparecem na UI de missões, que só busca gates por missionId — por isso são carregados
// e resolvidos aqui, por projectId. Ver memory/project_urna_projectid_incident.md.
export interface PendingGate {
  id:          string
  type:        string
  description: string
  status:      string
  // riskLevel/score vivem em `context`, não no topo — a API serializa o gate inteiro e
  // o Guardian guarda esses dois ali. Declarar `riskLevel: string` no topo compilava
  // (a resposta é convertida com `as`) e vinha undefined em runtime.
  context?:    { riskLevel?: string; score?: number } | null
  expiresAt:   string | null
  createdAt:   string
}

/** Nível de risco do gate, com fallback seguro para colorir a UI. */
export function gateRiskLevel(gate: PendingGate): string {
  return gate.context?.riskLevel ?? 'medium'
}

export function useGuardian(projectId: string | null) {
  const [latest,       setLatest]       = useState<GuardianReport | null>(null)
  const [history,      setHistory]      = useState<GuardianReport[]>([])
  const [pendingGates, setPendingGates] = useState<PendingGate[]>([])
  const [loading,       setLoading]      = useState(false)
  const [gateActionId,  setGateActionId] = useState<string | null>(null)
  const [error,         setError]        = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!projectId) return
    setLoading(true)
    setError(null)
    // allSettled, não all: com `all`, uma única chamada que falha por rede aborta as
    // outras duas antes de qualquer setState — a tela inteira vira erro mesmo que o
    // relatório e o histórico tenham respondido. Visto de verdade em 2026-08-08: o
    // painel exibia "Erro: Failed to fetch" no topo enquanto mostrava dados de um
    // carregamento anterior, sem indicar o que exatamente tinha falhado.
    const [latestRes, histRes, gatesRes] = await Promise.allSettled([
      fetch(`${V2_URL}/guardian/latest/${projectId}`, { headers: authHeaders() }),
      fetch(`${V2_URL}/guardian/history/${projectId}`, { headers: authHeaders() }),
      fetch(`${V2_URL}/approvals/pending?projectId=${projectId}`, { headers: authHeaders() }),
    ])

    const falhas: string[] = []

    try {
      if (latestRes.status === 'fulfilled') {
        if (latestRes.value.status === 200) setLatest(await latestRes.value.json() as GuardianReport)
        else if (latestRes.value.status === 404) setLatest(null)
      } else falhas.push('relatório')

      if (histRes.status === 'fulfilled') {
        if (histRes.value.ok) setHistory(await histRes.value.json() as GuardianReport[])
      } else falhas.push('histórico')

      if (gatesRes.status === 'fulfilled') {
        setPendingGates(gatesRes.value.ok ? await gatesRes.value.json() as PendingGate[] : [])
      } else falhas.push('aprovações pendentes')

      // Nomear o que caiu: "Failed to fetch" sozinho não dizia qual das três chamadas
      // falhou, e as três batem em serviços diferentes.
      setError(falhas.length ? `Falha ao carregar: ${falhas.join(', ')}` : null)
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

  const decideGate = useCallback(async (id: string, decision: 'approve' | 'reject') => {
    setGateActionId(id)
    try {
      const res = await fetch(`${V2_URL}/approvals/${id}/${decision}`, {
        method:  'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body:    JSON.stringify({ approvedBy: 'user' }),
      })
      if (res.ok) await load()
    } finally {
      setGateActionId(null)
    }
  }, [load])

  useEffect(() => { void load() }, [load])

  return {
    latest, history, loading, error, reload: load, override,
    pendingGates, gateActionId,
    approveGate: (id: string) => decideGate(id, 'approve'),
    rejectGate:  (id: string) => decideGate(id, 'reject'),
  }
}
