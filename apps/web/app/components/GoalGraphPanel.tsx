'use client'

import { useState } from 'react'
import dynamic from 'next/dynamic'
import { API_URL } from '../../lib/api-url'
import { authHeaders } from '../../lib/api-client'
import type {
  ProjectGoal, ProjectState, GoalGraphData, EventGraphData,
  SuccessCriteria, UniverseMap, UniverseNode, UniverseEdge,
} from '../hooks/useGoalGraph'

const GraphCanvas = dynamic(() => import('./GraphCanvas'), { ssr: false })
const UniverseCanvas = dynamic(() => import('./UniverseCanvas').then(m => ({ default: m.UniverseCanvas })), { ssr: false })

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

interface GoalGraphPanelProps {
  graphSubMode: 'estado' | 'goal' | 'eventos' | 'universe'
  setGraphSubMode: (m: 'estado' | 'goal' | 'eventos' | 'universe') => void
  graphLoading: boolean
  graphEventData: EventGraphData | null
  graphEventLoading: boolean
  loadEventGraph: () => void
  graphStateData: ProjectState | null
  setGraphStateData: (state: ProjectState) => void
  graphStateRefreshing: boolean
  refreshGraphState: () => void
  graphGoalData: GoalGraphData | null
  activeProjectId: string | null
  universeData: UniverseMap | null
  universeLoading: boolean
  universeSaving: boolean
  universeImporting: boolean
  loadUniverse: () => void
  saveUniverse: (nodes: UniverseNode[], edges: UniverseEdge[]) => Promise<void>
  importUniverse: () => Promise<void>
  openEditGoalForm: (goal: ProjectGoal) => void
  achieveGoal: (goalId: string) => void
  deleteGoal: (goalId: string) => void
  toggleCriteria: (goalId: string, criteriaId: string, done: boolean) => void
  saveCriteria: (goalId: string, criteria: SuccessCriteria[]) => void
  saveGoalKpis: (goalId: string, kpis: ProjectGoal['kpis']) => void
  autoTrackKpis: (goalId: string) => void
  autoTrackingKpis: boolean
  editingKpi: string | null
  setEditingKpi: (metric: string | null) => void
  kpiDraft: string
  setKpiDraft: (value: string) => void
  saveKpi: (goalId: string, metric: string) => void
  toggleHistory: () => void
  historyOpen: boolean
  historyLoading: boolean
  goalsHistory: ProjectGoal[] | null
  openCreateGoalForm: () => void
  openGraph: (sub: 'estado' | 'goal' | 'eventos' | 'universe') => void
  onClose: () => void
}

export function GoalGraphPanel({
  graphSubMode, setGraphSubMode, graphLoading,
  graphEventData, graphEventLoading, loadEventGraph,
  graphStateData, setGraphStateData, graphStateRefreshing, refreshGraphState,
  graphGoalData, activeProjectId,
  universeData, universeLoading, universeSaving, universeImporting, loadUniverse, saveUniverse, importUniverse,
  openEditGoalForm, achieveGoal, deleteGoal, toggleCriteria, saveCriteria, saveGoalKpis, autoTrackKpis, autoTrackingKpis,
  editingKpi, setEditingKpi, kpiDraft, setKpiDraft, saveKpi,
  toggleHistory, historyOpen, historyLoading, goalsHistory,
  openCreateGoalForm, openGraph, onClose,
}: GoalGraphPanelProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/70" onClick={onClose} />
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
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 text-lg leading-none">×</button>
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
                /* Sem meta ativa — mostra histórico para preservar rastreabilidade */
                <div className="space-y-4 py-2">
                  {historyLoading ? (
                    <div className="text-center text-xs text-zinc-500 py-4">Carregando histórico…</div>
                  ) : goalsHistory && goalsHistory.filter(g => g.status !== 'cancelled').length > 0 ? (
                    <div className="space-y-2">
                      <p className="text-xs text-zinc-500 font-medium uppercase tracking-wide">Metas anteriores</p>
                      {goalsHistory.filter(g => g.status !== 'cancelled').map(g => {
                        const total = g.successCriteria.length
                        const done  = g.successCriteria.filter(c => c.done).length
                        const pct   = total > 0 ? Math.round((done / total) * 100) : null
                        return <GoalHistoryCard key={g.id} g={g} isActive={false} total={total} done={done} pct={pct} />
                      })}
                    </div>
                  ) : null}
                  <div className="text-center py-4 space-y-3">
                    <p className="text-zinc-400 text-sm">Nenhuma meta ativa.</p>
                    <button onClick={openCreateGoalForm}
                      className="bg-blue-600 hover:bg-blue-500 text-white text-sm px-4 py-2 rounded-lg transition-colors">
                      Definir nova meta
                    </button>
                  </div>
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
  )
}
