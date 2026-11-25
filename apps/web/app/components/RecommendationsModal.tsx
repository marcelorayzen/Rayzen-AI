'use client'

import type { Recommendation } from '../page'

interface RecommendationsModalProps {
  recommendations: Recommendation[]
  recsLoading: boolean
  dismissing: string | null
  onDismiss: (id: string) => void
  onClose: () => void
}

export function RecommendationsModal({ recommendations, recsLoading, dismissing, onDismiss, onClose }: RecommendationsModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/70" onClick={onClose} />
      <div className="relative z-50 w-full max-w-lg bg-zinc-900 border border-zinc-800 rounded-2xl mx-4 max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
          <h2 className="text-sm font-semibold">Recomendações</h2>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 text-xs">fechar</button>
        </div>
        <div className="overflow-y-auto flex-1 px-6 py-4 space-y-3">
          {recsLoading && <p className="text-zinc-500 text-xs text-center py-8">Analisando projeto…</p>}
          {!recsLoading && recommendations.length === 0 && (
            <div className="text-center py-8">
              <p className="text-emerald-400 text-sm font-medium">Tudo em ordem</p>
              <p className="text-zinc-500 text-xs mt-1">Nenhuma inconsistência ou ação urgente identificada.</p>
            </div>
          )}
          {recommendations.map((rec) => (
            <div key={rec.id} className={`border rounded-xl p-4 space-y-2 ${
              rec.priority === 'high'   ? 'border-red-800 bg-red-950/30' :
              rec.priority === 'medium' ? 'border-amber-800 bg-amber-950/20' :
                                          'border-zinc-800 bg-zinc-900'
            }`}>
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-semibold uppercase ${
                    rec.priority === 'high'   ? 'bg-red-900 text-red-300' :
                    rec.priority === 'medium' ? 'bg-amber-900 text-amber-300' :
                                                'bg-zinc-700 text-zinc-400'
                  }`}>{rec.priority}</span>
                  <span className="text-[10px] text-zinc-600 font-mono">{rec.type}</span>
                </div>
                <button
                  onClick={() => onDismiss(rec.id)}
                  disabled={dismissing === rec.id}
                  className="text-zinc-600 hover:text-zinc-400 text-xs transition-colors disabled:opacity-40 shrink-0"
                  title="Descartar"
                >
                  {dismissing === rec.id ? '…' : '×'}
                </button>
              </div>
              <p className="text-xs font-medium text-zinc-200">{rec.title}</p>
              <p className="text-xs text-zinc-400">{rec.description}</p>
              {rec.action && (
                <p className="text-[10px] text-zinc-500 border-t border-zinc-800 pt-2 mt-1">
                  → {rec.action}
                </p>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
