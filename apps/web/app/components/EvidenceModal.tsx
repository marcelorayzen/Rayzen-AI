'use client'

import { API_URL } from '../../lib/api-url'
import type { EvidenceItem } from '../page'

export type EvidenceFilter = 'all' | 'with_run' | 'without_run'

interface EvidenceModalProps {
  evidenceItems: EvidenceItem[]
  evidenceLoading: boolean
  evidenceFilter: EvidenceFilter
  deletingEvidenceId: string | null
  onFilterChange: (filter: EvidenceFilter) => void
  onRefresh: () => void
  onDelete: (id: string) => void
  onClose: () => void
}

export function EvidenceModal({
  evidenceItems, evidenceLoading, evidenceFilter, deletingEvidenceId,
  onFilterChange, onRefresh, onDelete, onClose,
}: EvidenceModalProps) {
  return (
    <div className="fixed inset-0 z-[55] flex items-center justify-center">
      <div className="fixed inset-0 bg-black/80" onClick={onClose} />
      <div className="relative z-[55] w-full max-w-4xl bg-zinc-900 border border-zinc-800 rounded-2xl mx-4 max-h-[88vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
          <div>
            <h2 className="text-sm font-semibold">Evidencias</h2>
            <p className="text-xs text-zinc-500">Capturas visuais associadas ao projeto ativo.</p>
          </div>
          <div className="flex items-center gap-2">
            {(['all', 'with_run', 'without_run'] as const).map(filter => (
              <button
                key={filter}
                onClick={() => onFilterChange(filter)}
                className={`text-[10px] px-2 py-1 rounded-lg transition-colors ${evidenceFilter === filter ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'}`}
              >
                {filter === 'all' ? 'todas' : filter === 'with_run' ? 'com TestRun' : 'sem TestRun'}
              </button>
            ))}
            <button onClick={onRefresh} className="text-zinc-500 hover:text-zinc-300 text-xs">atualizar</button>
            <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 text-xs">fechar</button>
          </div>
        </div>
        <div className="p-6 overflow-y-auto">
          {evidenceLoading && <p className="text-zinc-500 text-xs text-center py-10">Carregando...</p>}
          {!evidenceLoading && evidenceItems.length === 0 && (
            <p className="text-zinc-500 text-xs text-center py-10">Nenhuma evidencia registrada ainda.</p>
          )}
          {!evidenceLoading && evidenceItems.length > 0 && (() => {
            const filtered = evidenceItems.filter(item =>
              evidenceFilter === 'all' ? true : evidenceFilter === 'with_run' ? Boolean(item.testRunId) : !item.testRunId,
            )
            const grouped = filtered.reduce<Record<string, EvidenceItem[]>>((acc, item) => {
              const key = item.testRunId ? `TestRun ${item.testRunId.slice(0, 8)}` : 'Sem TestRun vinculado'
              acc[key] = [...(acc[key] ?? []), item]
              return acc
            }, {})
            const entries = Object.entries(grouped)
            return entries.length === 0 ? (
              <p className="text-zinc-500 text-xs text-center py-10">Nenhuma evidencia neste filtro.</p>
            ) : (
              <div className="space-y-6">
                {entries.map(([group, items]) => (
                  <section key={group} className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="text-xs font-semibold text-zinc-400">{group}</h3>
                      <span className="text-[10px] text-zinc-600">{items.length} evidencia{items.length !== 1 ? 's' : ''}</span>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      {items.map((item) => (
                        <div key={item.id} className="rounded-xl border border-zinc-800 bg-zinc-950/60 overflow-hidden">
                          {item.remotePath ? (
                            // eslint-disable-next-line @next/next/no-img-element -- screenshot dinâmico servido pela API autenticada; otimizador do next/image não se aplica
                            <img
                              src={`${API_URL}/evidence/file/${item.remotePath.replace(/\\/g, '/')}`}
                              alt={item.prompt ? `Evidencia: ${item.prompt}` : 'Screenshot do projeto'}
                              className="w-full h-48 object-cover border-b border-zinc-800"
                            />
                          ) : (
                            <div className="h-48 flex items-center justify-center text-xs text-zinc-600 border-b border-zinc-800">
                              arquivo local ainda n?o sincronizado
                            </div>
                          )}
                          <div className="p-3 space-y-2">
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-1.5">
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-900 text-cyan-300">screenshot</span>
                                {item.category && item.category !== 'general' && (
                                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300">
                                    {item.category}
                                  </span>
                                )}
                                {item.testRunId && (
                                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-900 text-emerald-300" title={item.testRunId}>
                                    test run {item.testRunId.slice(0, 8)}
                                  </span>
                                )}
                              </div>
                              <span className="text-[10px] text-zinc-600">
                                {new Date(item.takenAt ?? item.createdAt).toLocaleString('pt-BR')}
                              </span>
                            </div>
                            {item.description
                              ? <p className="text-xs text-zinc-200 line-clamp-2">{item.description}</p>
                              : item.prompt && <p className="text-xs text-zinc-300 line-clamp-2">{item.prompt}</p>}
                            {item.localPath && (
                              <p className="text-[10px] font-mono text-zinc-600 truncate" title={item.localPath}>{item.localPath}</p>
                            )}
                            <div className="flex items-center justify-end gap-2 pt-1">
                              {item.remotePath && (
                                <a
                                  href={`${API_URL}/evidence/file/${item.remotePath.replace(/\\/g, '/')}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-[10px] text-cyan-400 hover:text-cyan-300"
                                >
                                  abrir
                                </a>
                              )}
                              <button
                                onClick={() => onDelete(item.id)}
                                disabled={deletingEvidenceId === item.id}
                                className="text-[10px] text-red-400 hover:text-red-300 disabled:opacity-40"
                              >
                                {deletingEvidenceId === item.id ? 'excluindo...' : 'excluir'}
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            )
          })()}
        </div>
      </div>
    </div>
  )
}
