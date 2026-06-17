'use client'

import { API_URL } from '../../lib/api-url'
import type { QARun, QARunDetail, QASummary, QATrendPoint, DataQualitySummary, DataAsset, QATab } from '../hooks/useQA'

interface QADashboardPanelProps {
  qaTab: QATab
  switchQATab: (tab: QATab) => void
  qaSummary: QASummary | null
  qaLoading: boolean
  qaTrend: QATrendPoint[]
  qaTrendLoading: boolean
  qaRuns: QARun[]
  qaRunsLoading: boolean
  qaRunDetail: QARunDetail | null
  qaRunDetailLoading: boolean
  selectQARun: (run: QARun) => void
  dqSummary: DataQualitySummary | null
  dqLoading: boolean
  catalogAssets: DataAsset[]
  catalogLoading: boolean
  onClose: () => void
}

export function QADashboardPanel({
  qaTab, switchQATab, qaSummary, qaLoading, qaTrend, qaTrendLoading,
  qaRuns, qaRunsLoading, qaRunDetail, qaRunDetailLoading, selectQARun,
  dqSummary, dqLoading, catalogAssets, catalogLoading, onClose,
}: QADashboardPanelProps) {
  return (
    <div className="fixed inset-0 z-[55] flex items-center justify-center">
      <div className="fixed inset-0 bg-black/80" onClick={onClose} />
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
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 text-xs">fechar</button>
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
                      <button onClick={() => selectQARun(run)} className="text-[10px] text-cyan-400 hover:text-cyan-300">detalhes</button>
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
  )
}
