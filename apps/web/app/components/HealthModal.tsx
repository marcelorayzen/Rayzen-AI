'use client'

import type { HealthBreakdown, HealthData } from '../page'

interface HealthModalProps {
  healthData: HealthData
  onClose: () => void
}

export function HealthModal({ healthData, onClose }: HealthModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/70" onClick={onClose} />
      <div className="relative z-50 w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-2xl mx-4 max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
          <div className="flex items-center gap-3">
            <span className={`text-2xl font-bold font-mono ${
              (healthData.current?.score ?? 0) >= 70 ? 'text-emerald-400' :
              (healthData.current?.score ?? 0) >= 40 ? 'text-amber-400' : 'text-red-400'
            }`}>⬡ {healthData.current?.score ?? '—'}</span>
            <div>
              <p className="text-sm font-semibold">Health score</p>
              {healthData.current && (
                <p className="text-[10px] text-zinc-500">{new Date(healthData.current.createdAt).toLocaleString('pt-BR')}</p>
              )}
            </div>
          </div>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 text-xs">fechar</button>
        </div>
        <div className="overflow-y-auto flex-1 px-6 py-4 space-y-5">
          {healthData.current && (
            <div className="space-y-2">
              <p className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wide">Breakdown</p>
              {([
                ['Atividade recente', 'activity', 20],
                ['Documentação em dia', 'documentation', 20],
                ['Consistência', 'consistency', 20],
                ['Next steps claros', 'nextSteps', 15],
                ['Blockers resolvendo', 'blockers', 15],
                ['Foco definido', 'focus', 10],
              ] as Array<[string, keyof HealthBreakdown, number]>).map(([label, key, weight]) => {
                const val = healthData.current!.breakdown[key]
                return (
                  <div key={key}>
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="text-xs text-zinc-400">{label}</span>
                      <span className="text-xs font-mono text-zinc-300">{val} <span className="text-zinc-600">/ 100 · {weight}%</span></span>
                    </div>
                    <div className="w-full h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${
                          val >= 70 ? 'bg-emerald-500' : val >= 40 ? 'bg-amber-500' : 'bg-red-500'
                        }`}
                        style={{ width: `${val}%` }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
          {healthData.history.length > 1 && (
            <div>
              <p className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wide mb-2">Histórico 30 dias</p>
              <div className="flex items-end gap-0.5 h-12">
                {healthData.history.map((h) => (
                  <div
                    key={h.id}
                    className={`flex-1 rounded-sm min-w-[4px] transition-all ${
                      h.score >= 70 ? 'bg-emerald-600' : h.score >= 40 ? 'bg-amber-600' : 'bg-red-700'
                    }`}
                    style={{ height: `${Math.max(4, h.score)}%` }}
                    title={`${new Date(h.createdAt).toLocaleDateString('pt-BR')}: ${h.score}`}
                  />
                ))}
              </div>
              <div className="flex justify-between mt-1">
                <span className="text-[9px] text-zinc-700">{new Date(healthData.history[0].createdAt).toLocaleDateString('pt-BR')}</span>
                <span className="text-[9px] text-zinc-700">{new Date(healthData.history[healthData.history.length - 1].createdAt).toLocaleDateString('pt-BR')}</span>
              </div>
            </div>
          )}
          {!healthData.current && (
            <p className="text-zinc-500 text-xs text-center py-6">Nenhum score calculado. Faça um refresh do estado do projeto para calcular.</p>
          )}
        </div>
      </div>
    </div>
  )
}
