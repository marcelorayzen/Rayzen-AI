'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { V2_URL } from '../../../lib/api-url'
import { authHeaders } from '../../../lib/api-client'
import { useRayzenEvents } from '../../hooks/useRayzenEvents'

type MissionStatus = 'pending' | 'active' | 'paused' | 'done' | 'failed' | 'cancelled'
type StepStatus    = 'pending' | 'running' | 'done' | 'failed' | 'skipped'

interface MissionStep {
  id: string
  title: string
  status: StepStatus
  executor: string
  skillId: string | null
  prompt: string | null
  startedAt: string | null
  completedAt: string | null
  createdAt: string
}

interface Mission {
  id: string
  projectId: string
  title: string
  objective: string
  status: MissionStatus
  specialistId: string | null
  createdAt: string
  startedAt: string | null
  completedAt: string | null
  updatedAt: string
  steps: MissionStep[]
  context?: { _contract?: IntentContractSummary } & Record<string, unknown>
}

interface IntentContractSummary {
  intentType?: string
  confidence?: number
  riskLevel?: 'low' | 'medium' | 'high'
  successCriteria?: string[]
  reasoning?: string
}

const RISK_COLOR: Record<string, string> = {
  low:    '#22c55e',
  medium: '#facc15',
  high:   '#ef4444',
}

interface ApprovalGate {
  id: string
  missionId: string | null
  stepId: string | null
  type: string
  description: string
  status: string
  createdAt: string
  expiresAt: string | null
}

const GATE_RISK_LABEL: Record<string, string> = {
  irreversible: 'alto risco',
  data_write:   'risco médio',
  code_deploy:  'deploy',
  external_api: 'API externa',
  high_cost:    'alto custo',
}

const STATUS_COLOR: Record<string, string> = {
  pending:   'var(--hud-dim)',
  active:    'var(--hud-cyan)',
  paused:    '#facc15',
  done:      '#22c55e',
  failed:    '#ef4444',
  cancelled: 'var(--hud-text-2)',
  running:   'var(--hud-cyan)',
  skipped:   'var(--hud-text-2)',
}

const STATUS_LABEL: Record<string, string> = {
  pending:   'PENDENTE',
  active:    'ATIVA',
  paused:    'PAUSADA',
  done:      'CONCLUÍDA',
  failed:    'FALHOU',
  cancelled: 'CANCELADA',
}

const STEP_ICON: Record<StepStatus, string> = {
  pending: '○',
  running: '●',
  done:    '✓',
  failed:  '✗',
  skipped: '–',
}

function elapsed(from: string | null, to: string | null): string | null {
  if (!from) return null
  const ms = new Date(to ?? Date.now()).getTime() - new Date(from).getTime()
  const s = Math.floor(ms / 1000)
  if (s < 60)   return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`
}

export default function MissionDetailPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const id = params.id

  const [mission, setMission] = useState<Mission | null>(null)
  const [gates, setGates]     = useState<ApprovalGate[]>([])
  const [loading, setLoading] = useState(true)
  const [acting, setActing]   = useState<string | null>(null)
  const [note, setNote]       = useState<string | null>(null)

  const loadGates = useCallback(async () => {
    try {
      const res = await fetch(`${V2_URL}/approvals/pending?missionId=${id}`, { headers: authHeaders() })
      if (res.ok) setGates(await res.json() as ApprovalGate[])
    } catch { /* informativo — não bloqueia a página */ }
  }, [id])

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${V2_URL}/missions/${id}`, { headers: authHeaders() })
      if (res.ok) setMission(await res.json() as Mission)
      else setNote(`Missão não encontrada (HTTP ${res.status})`)
      await loadGates()
    } finally {
      setLoading(false)
    }
  }, [id, loadGates])

  useEffect(() => {
    void load()
  }, [load])

  // poll while active or paused (gates de aprovação aparecem quando pausada)
  useEffect(() => {
    if (!mission || (mission.status !== 'active' && mission.status !== 'paused')) return
    const t = setInterval(() => void load(), 3000)
    return () => clearInterval(t)
  }, [mission, load])

  // WebSocket: atualização em tempo quase-real quando o gateway estiver acessível
  // (aditivo — o polling acima continua como fallback se o WS não conectar)
  useRayzenEvents(mission?.projectId ?? null, (e) => {
    if (e.type === 'mission_update' || e.type === 'approval_gate') void load()
  })

  const decideGate = async (gateId: string, decision: 'approve' | 'reject') => {
    if (acting) return
    setActing(`gate-${gateId}-${decision}`)
    setNote(null)
    try {
      const res = await fetch(`${V2_URL}/approvals/${gateId}/${decision}`, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ approvedBy: 'Marcelo' }),
      })
      if (!res.ok) { setNote(`Erro ao ${decision === 'approve' ? 'aprovar' : 'rejeitar'} (HTTP ${res.status})`); return }
      // approve re-roda o DAG no backend; reject pausa — recarrega para refletir
      await load()
    } catch (err) {
      setNote(err instanceof Error ? err.message : 'falha na decisão do gate')
    } finally {
      setActing(null)
    }
  }

  // Steps executor:'human' pausam a missão esperando uma ação real da pessoa —
  // antes só dava pra resolver via PATCH manual (curl). Espelha o padrão de
  // decideGate: marca o step concluído e recarrega pra missão retomar.
  const completeHumanStep = async (stepId: string) => {
    if (acting) return
    setActing(`human-${stepId}`)
    setNote(null)
    try {
      const res = await fetch(`${V2_URL}/missions/${id}/steps/${stepId}`, {
        method: 'PATCH',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'done', output: { verifiedBy: 'Marcelo', verifiedAt: new Date().toISOString() } }),
      })
      if (!res.ok) { setNote(`Erro ao concluir step (HTTP ${res.status})`); return }
      await load()
    } catch (err) {
      setNote(err instanceof Error ? err.message : 'falha ao concluir step')
    } finally {
      setActing(null)
    }
  }

  const action = async (endpoint: string, label: string, body?: Record<string, unknown>) => {
    if (acting) return
    setActing(label)
    setNote(null)
    try {
      const res = await fetch(`${V2_URL}/missions/${id}/${endpoint}`, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      })
      if (!res.ok) { setNote(`Erro ao ${label} (HTTP ${res.status})`); return }
      await load()
    } catch (err) {
      setNote(err instanceof Error ? err.message : `falha ao ${label}`)
    } finally {
      setActing(null)
    }
  }

  const executeWorkflow = async (label: string) => {
    if (acting || !mission) return
    setActing(label)
    setNote(null)
    try {
      const res = await fetch(`${V2_URL}/workflows/missions/${id}/execute`, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: mission.projectId }),
      })
      if (!res.ok) { setNote(`Erro ao ${label} (HTTP ${res.status})`); return }
      await load()
    } catch (err) {
      setNote(err instanceof Error ? err.message : `falha ao ${label}`)
    } finally {
      setActing(null)
    }
  }

  if (loading) return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: '20px 16px' }}>
      <div className="hud-pulse" style={{ color: 'var(--hud-dim)', fontSize: 13 }}>carregando…</div>
    </div>
  )

  if (!mission) return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: '20px 16px', color: '#ef4444', fontSize: 13 }}>
      {note ?? 'Missão não encontrada.'} <Link href="/mission" style={{ color: 'var(--hud-cyan)' }}>← voltar</Link>
    </div>
  )

  const statusColor = STATUS_COLOR[mission.status]
  const totalTime   = elapsed(mission.startedAt, mission.completedAt)
  const gatedStepIds = new Set(gates.map((g) => g.stepId).filter(Boolean) as string[])
  const contract = mission.context?._contract
  const pendingHumanSteps = mission.steps.filter((s) => s.executor === 'human' && s.status === 'pending')
  const doneSteps   = mission.steps.filter((s) => s.status === 'done' || s.status === 'skipped').length
  const pct         = mission.steps.length ? Math.round((doneSteps / mission.steps.length) * 100) : 0

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: '20px 16px', minHeight: '100vh', display: 'flex', flexDirection: 'column', gap: 14 }}>

      {/* Header */}
      <div className="hud-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Link href="/mission" className="hud-btn" style={{ fontSize: 12 }}>← missões</Link>
        <Link href="/" className="hud-btn" style={{ fontSize: 12 }}>painel</Link>
      </div>

      {/* Mission card */}
      <div className="hud-card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {/* Title + status */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ fontWeight: 700, fontSize: 16, lineHeight: 1.3 }}>{mission.title}</div>
          <span style={{
            fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 3, flexShrink: 0,
            border: `1px solid ${statusColor}`, color: statusColor,
          }}>
            {STATUS_LABEL[mission.status]}
          </span>
        </div>

        {/* Objective */}
        <div style={{ fontSize: 13, color: 'var(--hud-text-2)', lineHeight: 1.5 }}>{mission.objective}</div>

        {/* Meta row */}
        <div style={{ display: 'flex', gap: 16, fontSize: 11, color: 'var(--hud-dim)' }}>
          <span>{mission.steps.length} step{mission.steps.length !== 1 ? 's' : ''}</span>
          {totalTime && <span>⏱ {totalTime}</span>}
          <span>criada {new Date(mission.createdAt).toLocaleDateString('pt-BR')}</span>
          {mission.specialistId && <span>🔬 specialist</span>}
        </div>

        {/* Progress bar */}
        {mission.steps.length > 0 && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--hud-dim)', marginBottom: 4 }}>
              <span>{doneSteps}/{mission.steps.length} concluídos</span>
              <span>{pct}%</span>
            </div>
            <div style={{ height: 4, background: 'var(--hud-surface)', borderRadius: 2, overflow: 'hidden' }}>
              <div style={{ width: `${pct}%`, height: '100%', background: statusColor, transition: 'width 0.4s' }} />
            </div>
          </div>
        )}

        {/* Actions */}
        <div style={{ display: 'flex', gap: 8, paddingTop: 4, flexWrap: 'wrap' }}>
          <button
            className="hud-btn hud-btn-primary"
            onClick={() => router.push(`/work-panel?mission=${id}`)}
            title="Abre o work-panel com o objetivo desta missão pré-carregado"
          >
            trabalhar
          </button>
          {mission.status === 'pending' && (
            <button className="hud-btn hud-btn-primary" onClick={() => void executeWorkflow('executar')} disabled={!!acting}>
              {acting === 'executar' ? 'executando…' : 'executar'}
            </button>
          )}
          {mission.status === 'active' && (
            <button className="hud-btn" onClick={() => void action('pause', 'pausar')} disabled={!!acting}>
              {acting === 'pausar' ? 'pausando…' : 'pausar'}
            </button>
          )}
          {mission.status === 'paused' && (
            <button className="hud-btn hud-btn-primary" onClick={() => void executeWorkflow('retomar')} disabled={!!acting}>
              {acting === 'retomar' ? 'retomando…' : 'retomar'}
            </button>
          )}
          {(mission.status === 'active' || mission.status === 'paused') && (
            <>
              <button className="hud-btn" style={{ color: '#22c55e' }} onClick={() => void action('complete', 'concluir')} disabled={!!acting}>
                {acting === 'concluir' ? 'concluindo…' : 'concluir'}
              </button>
              <button className="hud-btn" style={{ color: '#ef4444' }} onClick={() => void action('cancel', 'cancelar')} disabled={!!acting}>
                {acting === 'cancelar' ? 'cancelando…' : 'cancelar'}
              </button>
            </>
          )}
          {mission.status === 'pending' && (
            <button className="hud-btn" style={{ color: '#ef4444' }} onClick={() => void action('cancel', 'cancelar')} disabled={!!acting}>
              cancelar
            </button>
          )}
        </div>

        {note && <div style={{ color: '#ef4444', fontSize: 12 }}>{note}</div>}
      </div>

      {/* IntentContract — rastreabilidade (intenção classificada, risco, critérios de sucesso) */}
      {contract && (
        <div className="hud-card" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--hud-dim)' }}>Intent Contract</span>
            {contract.intentType && (
              <span style={{ padding: '2px 7px', borderRadius: 4, background: 'var(--hud-cyan-10)', border: '1px solid var(--hud-cyan-20)' }}>{contract.intentType}</span>
            )}
            {contract.riskLevel && (
              <span style={{ padding: '2px 7px', borderRadius: 4, border: `1px solid ${RISK_COLOR[contract.riskLevel]}`, color: RISK_COLOR[contract.riskLevel] }}>
                risco {contract.riskLevel}
              </span>
            )}
            {typeof contract.confidence === 'number' && (
              <span style={{ color: 'var(--hud-dim)' }}>confiança {Math.round(contract.confidence * 100)}%</span>
            )}
          </div>
          {contract.reasoning && <div style={{ color: 'var(--hud-text-2)', lineHeight: 1.5 }}>{contract.reasoning}</div>}
          {contract.successCriteria && contract.successCriteria.length > 0 && (
            <div>
              <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--hud-dim)', marginBottom: 4 }}>Critérios de sucesso</div>
              <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 3 }}>
                {contract.successCriteria.map((c, i) => (
                  <li key={i} style={{ color: 'var(--hud-text-2)' }}>{c}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Approval gates pendentes — aprovar retoma a missão (gate→resume) */}
      {gates.length > 0 && (
        <div className="hud-card" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 8, border: '1px solid #facc15' }}>
          <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, color: '#facc15' }}>
            Aprovações pendentes ({gates.length})
          </div>
          {gates.map((g) => {
            const gatedStep = mission.steps.find((s) => s.id === g.stepId)
            return (
              <div key={g.id} style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingTop: 8, borderTop: '1px solid var(--hud-border)' }}>
                <div style={{ fontSize: 13 }}>{g.description}</div>
                <div style={{ display: 'flex', gap: 10, fontSize: 11, color: 'var(--hud-dim)' }}>
                  <span style={{ color: g.type === 'irreversible' ? '#ef4444' : '#facc15' }}>{GATE_RISK_LABEL[g.type] ?? g.type}</span>
                  {gatedStep && <span>step: {gatedStep.title}</span>}
                </div>
                <div style={{ display: 'flex', gap: 8, paddingTop: 2 }}>
                  <button className="hud-btn hud-btn-primary" onClick={() => void decideGate(g.id, 'approve')} disabled={!!acting}>
                    {acting === `gate-${g.id}-approve` ? 'aprovando…' : 'aprovar e retomar'}
                  </button>
                  <button className="hud-btn" style={{ color: '#ef4444' }} onClick={() => void decideGate(g.id, 'reject')} disabled={!!acting}>
                    {acting === `gate-${g.id}-reject` ? 'rejeitando…' : 'rejeitar'}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Ações humanas pendentes — diferente de gate: não há risco a aprovar, é uma
          tarefa que só uma pessoa pode marcar como feita (ex: "verificar CI no ar") */}
      {pendingHumanSteps.length > 0 && (
        <div className="hud-card" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 8, border: '1px solid var(--hud-cyan)' }}>
          <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--hud-cyan)' }}>
            Ação humana pendente ({pendingHumanSteps.length})
          </div>
          {pendingHumanSteps.map((s) => (
            <div key={s.id} style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingTop: 8, borderTop: '1px solid var(--hud-border)' }}>
              <div style={{ fontSize: 13 }}>{s.title}</div>
              {s.prompt && <div style={{ fontSize: 12, color: 'var(--hud-text-2)', lineHeight: 1.4 }}>{s.prompt}</div>}
              <div style={{ display: 'flex', gap: 8, paddingTop: 2 }}>
                <button className="hud-btn hud-btn-primary" onClick={() => void completeHumanStep(s.id)} disabled={!!acting}>
                  {acting === `human-${s.id}` ? 'concluindo…' : 'marcar como concluído'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Steps timeline */}
      {mission.steps.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--hud-dim)', marginBottom: 6 }}>Steps</div>
          {mission.steps.map((step, idx) => {
            const sc    = STATUS_COLOR[step.status]
            const dur   = elapsed(step.startedAt, step.completedAt)
            const isRunning = step.status === 'running'
            return (
              <div key={step.id} style={{
                display: 'flex', alignItems: 'flex-start', gap: 10,
                padding: '10px 12px', borderRadius: 4,
                background: isRunning ? 'var(--hud-surface)' : undefined,
                border: isRunning ? '1px solid var(--hud-cyan-40)' : '1px solid transparent',
              }}>
                {/* connector line */}
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 2 }}>
                  <span className={isRunning ? 'hud-pulse' : ''} style={{ color: sc, fontSize: 14, lineHeight: 1 }}>
                    {STEP_ICON[step.status]}
                  </span>
                  {idx < mission.steps.length - 1 && (
                    <div style={{ width: 1, flex: 1, minHeight: 14, background: 'var(--hud-surface)', margin: '3px 0' }} />
                  )}
                </div>

                {/* content */}
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: step.status === 'pending' ? 'var(--hud-text-2)' : 'var(--hud-text)' }}>
                    {step.title}
                  </div>
                  <div style={{ display: 'flex', gap: 8, fontSize: 11, color: 'var(--hud-dim)' }}>
                    <span>{step.executor}</span>
                    {step.skillId && <span>skill:{step.skillId}</span>}
                    {dur && <span>⏱ {dur}</span>}
                    {gatedStepIds.has(step.id) && <span style={{ color: '#facc15' }}>🔒 aguardando aprovação</span>}
                  </div>
                </div>

                {/* status label */}
                <span style={{ fontSize: 10, color: sc, flexShrink: 0, paddingTop: 3 }}>
                  {step.status}
                </span>
              </div>
            )
          })}
        </div>
      )}

      {mission.steps.length === 0 && mission.status === 'pending' && (
        <div style={{ color: 'var(--hud-dim)', fontSize: 12, textAlign: 'center', padding: '20px 0' }}>
          Steps serão gerados ao executar o workflow.
        </div>
      )}
    </div>
  )
}
