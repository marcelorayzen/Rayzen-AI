'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { API_URL } from '../../lib/api-url'
import { authHeaders } from '../../lib/api-client'
import { useGuardian, type GuardianReport } from '../hooks/useGuardian'

interface Project { id: string; name: string; status: string }

const RISK_COLOR: Record<string, string> = {
  low:      '#22c55e',
  medium:   '#f59e0b',
  high:     '#ef4444',
  critical: '#dc2626',
}

const RISK_BG: Record<string, string> = {
  low:      'rgba(34,197,94,0.10)',
  medium:   'rgba(245,158,11,0.10)',
  high:     'rgba(239,68,68,0.12)',
  critical: 'rgba(220,38,38,0.16)',
}

const RISK_EMOJI: Record<string, string> = {
  low: '✅', medium: '⚠️', high: '🔴', critical: '🚨',
}

function RiskBadge({ level, score }: { level: string; score: number }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-bold"
      style={{ background: RISK_BG[level] ?? RISK_BG.medium, color: RISK_COLOR[level] ?? RISK_COLOR.medium, border: `1px solid ${RISK_COLOR[level] ?? RISK_COLOR.medium}40` }}
    >
      {RISK_EMOJI[level] ?? '⚠️'} {level.toUpperCase()} ({score})
    </span>
  )
}

function DeployBadge({ recommend }: { recommend: string }) {
  const map: Record<string, { label: string; color: string }> = {
    safe:   { label: 'Deploy seguro',     color: '#22c55e' },
    review: { label: 'Revisar antes',     color: '#f59e0b' },
    block:  { label: 'Deploy bloqueado',  color: '#ef4444' },
  }
  const m = map[recommend] ?? map.review
  return (
    <span className="text-xs font-medium" style={{ color: m.color }}>
      {m.label}
    </span>
  )
}

function ReportCard({
  report,
  onOverride,
}: {
  report: GuardianReport
  onOverride: (id: string, reason: string) => void
}) {
  const [overrideMode, setOverrideMode] = useState(false)
  const [reason, setReason]             = useState('')

  const handleOverride = () => {
    if (!reason.trim()) return
    onOverride(report.id, reason.trim())
    setOverrideMode(false)
    setReason('')
  }

  return (
    <div
      className="rounded-xl p-5 flex flex-col gap-4"
      style={{ background: 'var(--hud-card)', border: '1px solid var(--hud-border-hi)' }}
    >
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex flex-col gap-1.5">
          <RiskBadge level={report.riskLevel} score={report.riskScore} />
          <p className="text-sm" style={{ color: 'var(--hud-text-2)' }}>{report.summary}</p>
        </div>
        <DeployBadge recommend={report.deployRecommend} />
      </div>

      {report.filesWithoutTests.length > 0 && (
        <div>
          <p className="text-xs font-semibold mb-2" style={{ color: 'var(--hud-text-2)' }}>
            Arquivos sem spec ({report.filesWithoutTests.length})
          </p>
          <div className="flex flex-col gap-1">
            {report.filesWithoutTests.map((f) => (
              <div key={f} className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: RISK_COLOR[report.riskLevel] }} />
                <code className="text-xs break-all" style={{ color: 'var(--hud-text-2)' }}>{f}</code>
              </div>
            ))}
          </div>
        </div>
      )}

      {report.suggestedTests.length > 0 && (
        <div>
          <p className="text-xs font-semibold mb-2" style={{ color: 'var(--hud-text-2)' }}>
            Specs sugeridas
          </p>
          <div className="flex flex-col gap-1.5">
            {report.suggestedTests.slice(0, 5).map((s) => (
              <div key={s.testFile} className="rounded-lg px-3 py-2 text-xs" style={{ background: 'var(--hud-elevated)', color: 'var(--hud-dim)' }}>
                <code style={{ color: 'var(--hud-cyan)' }}>{s.testFile}</code>
              </div>
            ))}
          </div>
        </div>
      )}

      {report.changedFiles.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer" style={{ color: 'var(--hud-dim)' }}>
            {report.changedFiles.length} arquivo(s) alterado(s)
          </summary>
          <div className="mt-2 flex flex-col gap-0.5 pl-2">
            {report.changedFiles.map((f) => (
              <code key={f} style={{ color: 'var(--hud-text-2)' }}>{f}</code>
            ))}
          </div>
        </details>
      )}

      <div className="flex items-center justify-between flex-wrap gap-2">
        <span className="text-xs" style={{ color: 'var(--hud-dim)' }}>
          {new Date(report.createdAt).toLocaleString('pt-BR')}
        </span>
        {report.riskLevel === 'critical' && !report.overridden && (
          <div className="flex items-center gap-2">
            {overrideMode ? (
              <>
                <input
                  className="text-xs rounded px-2 py-1 border"
                  style={{ background: 'var(--hud-elevated)', border: '1px solid var(--hud-border)', color: 'var(--hud-text)', width: '200px' }}
                  placeholder="Motivo do override…"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleOverride()}
                  autoFocus
                />
                <button
                  onClick={handleOverride}
                  disabled={!reason.trim()}
                  className="text-xs px-2 py-1 rounded transition-colors"
                  style={{ background: '#ef4444', color: '#fff', opacity: reason.trim() ? 1 : 0.4 }}
                >
                  confirmar
                </button>
                <button
                  onClick={() => setOverrideMode(false)}
                  className="text-xs"
                  style={{ color: 'var(--hud-dim)' }}
                >
                  cancelar
                </button>
              </>
            ) : (
              <button
                onClick={() => setOverrideMode(true)}
                className="text-xs px-2 py-1 rounded border transition-colors hover:border-red-500 hover:text-red-400"
                style={{ border: '1px solid var(--hud-border)', color: 'var(--hud-text-2)' }}
              >
                override bloqueio
              </button>
            )}
          </div>
        )}
        {report.overridden && (
          <span className="text-xs px-2 py-1 rounded" style={{ background: 'rgba(245,158,11,0.1)', color: '#f59e0b' }}>
            overridden: {report.overrideReason}
          </span>
        )}
      </div>
    </div>
  )
}

export default function GuardianPage() {
  const [projects, setProjects]   = useState<Project[]>([])
  const [projectId, setProjectId] = useState<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const { latest, history, loading, error, reload, override } = useGuardian(projectId)

  // load projects
  useEffect(() => {
    const saved = typeof window !== 'undefined' ? localStorage.getItem('rayzen_active_project_id') : null
    fetch(`${API_URL}/projects`, { headers: authHeaders() })
      .then((r) => r.json())
      .then((d: unknown) => {
        const list = Array.isArray(d) ? (d as Project[]) : []
        setProjects(list)
        const exists = saved && list.some((p: Project) => p.id === saved)
        setProjectId((exists ? saved : (list.find((p: Project) => p.status === 'active') ?? list[0])?.id) ?? null)
      })
      .catch(() => setProjects([]))
  }, [])

  // poll every 30s
  useEffect(() => {
    if (!projectId) return
    pollRef.current = setInterval(reload, 30_000)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [projectId, reload])

  return (
    <div className="min-h-screen" style={{ background: 'var(--hud-bg)', color: 'var(--hud-text)' }}>
      {/* header */}
      <div className="hud-header sticky top-0 z-30 px-6 py-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link href="/" className="hud-nav text-xs">← voltar</Link>
          <span className="text-sm font-bold" style={{ color: 'var(--hud-text)' }}>Guardian</span>
          <span className="text-xs" style={{ color: 'var(--hud-dim)' }}>vigilância proativa</span>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={projectId ?? ''}
            onChange={(e) => setProjectId(e.target.value || null)}
            className="bg-zinc-800 border border-zinc-700 text-zinc-300 text-xs rounded-lg px-2 py-1.5 focus:outline-none focus:border-zinc-500"
          >
            <option value="">sem projeto</option>
            {projects.filter((p) => p.status === 'active').map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <button onClick={reload} className="hud-nav text-xs" title="Atualizar">↻ atualizar</button>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-6 py-8 flex flex-col gap-8">
        {!projectId && (
          <p className="text-sm" style={{ color: 'var(--hud-dim)' }}>Selecione um projeto acima.</p>
        )}

        {projectId && loading && (
          <p className="text-sm" style={{ color: 'var(--hud-dim)' }}>Carregando…</p>
        )}

        {projectId && error && (
          <p className="text-sm" style={{ color: '#ef4444' }}>Erro: {error}</p>
        )}

        {/* latest report */}
        {projectId && !loading && (
          <section>
            <h2 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--hud-dim)' }}>
              Último relatório
            </h2>
            {latest ? (
              <ReportCard report={latest} onOverride={override} />
            ) : (
              <div
                className="rounded-xl p-5 text-center text-sm"
                style={{ background: 'var(--hud-card)', border: '1px solid var(--hud-border)', color: 'var(--hud-dim)' }}
              >
                Nenhum relatório ainda — o Guardian analisa automaticamente após mudanças no workspace.
              </div>
            )}
          </section>
        )}

        {/* history */}
        {projectId && !loading && history.length > 1 && (
          <section>
            <h2 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--hud-dim)' }}>
              Histórico ({history.length})
            </h2>
            <div className="flex flex-col gap-2">
              {history.slice(1).map((r) => (
                <div
                  key={r.id}
                  className="flex items-center justify-between gap-3 px-4 py-2.5 rounded-lg"
                  style={{ background: 'var(--hud-surface)', border: '1px solid var(--hud-border)' }}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span style={{ color: RISK_COLOR[r.riskLevel] }}>{RISK_EMOJI[r.riskLevel]}</span>
                    <span className="text-xs font-semibold" style={{ color: RISK_COLOR[r.riskLevel] }}>
                      {r.riskLevel.toUpperCase()} ({r.riskScore})
                    </span>
                    <span className="text-xs truncate" style={{ color: 'var(--hud-dim)' }}>
                      {r.changedFiles.length} arquivo(s)
                      {r.filesWithoutTests.length > 0 && ` · ${r.filesWithoutTests.length} sem spec`}
                    </span>
                  </div>
                  <span className="text-xs flex-shrink-0" style={{ color: 'var(--hud-dim)' }}>
                    {new Date(r.createdAt).toLocaleString('pt-BR', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* install hint */}
        {projectId && !loading && (
          <section
            className="rounded-xl p-4"
            style={{ background: 'var(--hud-surface)', border: '1px solid var(--hud-border)' }}
          >
            <p className="text-xs font-semibold mb-2" style={{ color: 'var(--hud-text-2)' }}>Pre-push hook</p>
            <code className="text-xs block" style={{ color: 'var(--hud-dim)' }}>
              pnpm guardian:install-hooks
            </code>
            <p className="text-xs mt-1" style={{ color: 'var(--hud-dim)' }}>
              Bloqueia push automático quando riskLevel=critical.
            </p>
          </section>
        )}
      </div>
    </div>
  )
}
