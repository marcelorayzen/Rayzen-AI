'use client'

import type { CostSummary } from '../page'

export type CostsPeriod = 'today' | 'week' | 'month' | 'all'

interface CostsModalProps {
  costsPeriod: CostsPeriod
  costsData: CostSummary | null
  costsLoading: boolean
  activeProjectId: string | null
  onPeriodChange: (period: CostsPeriod) => void
  onClose: () => void
}

export function CostsModal({ costsPeriod, costsData, costsLoading, activeProjectId, onPeriodChange, onClose }: CostsModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/70" onClick={onClose} />
      <div className="relative z-50 w-full max-w-lg bg-zinc-900 border border-zinc-800 rounded-2xl mx-4 max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
          <div>
            <p className="text-sm font-semibold">◈ Análise de custos LLM</p>
            <p className="text-[10px] text-zinc-500">Estimativa baseada em tokens registrados por módulo</p>
          </div>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 text-xs">fechar</button>
        </div>
        <div className="px-6 pt-3 pb-2 flex gap-2">
          {(['today', 'week', 'month', 'all'] as const).map(p => (
            <button
              key={p}
              onClick={() => onPeriodChange(p)}
              className={`text-xs px-2.5 py-1 rounded-lg transition-colors ${costsPeriod === p ? 'bg-violet-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'}`}
            >
              {p === 'today' ? 'Hoje' : p === 'week' ? '7 dias' : p === 'month' ? 'Mês' : 'Tudo'}
            </button>
          ))}
        </div>
        <div className="overflow-y-auto flex-1 px-6 py-3 space-y-5">
          {costsLoading && <p className="text-zinc-500 text-xs text-center py-6">carregando...</p>}
          {!costsLoading && costsData && (
            <>
              {/* Totals */}
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: 'Tokens', value: costsData.totals.tokens.toLocaleString('pt-BR') },
                  { label: 'Mensagens', value: costsData.totals.messages.toLocaleString('pt-BR') },
                  { label: 'Custo est.', value: `$${costsData.totals.costUSD.toFixed(4)}` },
                ].map(({ label, value }) => (
                  <div key={label} className="bg-zinc-800/60 rounded-xl p-3 text-center">
                    <p className="text-[10px] text-zinc-500 mb-1">{label}</p>
                    <p className="text-sm font-mono font-semibold text-zinc-200">{value}</p>
                  </div>
                ))}
              </div>

              {/* By module */}
              {costsData.byModule.length > 0 && (
                <div>
                  <p className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wide mb-2">Por módulo</p>
                  <div className="space-y-1">
                    {costsData.byModule.map((r) => {
                      const pct = costsData.totals.tokens > 0 ? Math.round((r.tokens / costsData.totals.tokens) * 100) : 0
                      return (
                        <div key={r.module} className="flex items-center gap-2">
                          <div className="w-24 text-xs text-zinc-300 truncate font-mono">{r.module}</div>
                          <div className="flex-1 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                            <div className="h-full bg-violet-500 rounded-full" style={{ width: `${pct}%` }} />
                          </div>
                          <div className="text-[10px] text-zinc-500 w-12 text-right">{pct}%</div>
                          <div className="text-[10px] font-mono text-zinc-400 w-16 text-right">${r.costUSD.toFixed(4)}</div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* By project */}
              {!activeProjectId && costsData.byProject.length > 0 && (
                <div>
                  <p className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wide mb-2">Por projeto</p>
                  <div className="space-y-1">
                    {costsData.byProject.map((r, i) => (
                      <div key={i} className="flex items-center justify-between text-xs">
                        <span className="text-zinc-300 truncate flex-1">{r.projectName ?? 'sem projeto'}</span>
                        <span className="font-mono text-zinc-400 ml-2">{r.tokens.toLocaleString('pt-BR')} tok</span>
                        <span className="font-mono text-violet-400 ml-2 w-16 text-right">${r.costUSD.toFixed(4)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Pricing reference */}
              <div>
                <p className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wide mb-2">Tabela de preços ($/1M tokens)</p>
                <div className="grid grid-cols-2 gap-1">
                  {Object.entries(costsData.pricing).map(([model, price]) => (
                    <div key={model} className="flex items-center justify-between text-[10px] bg-zinc-800/40 rounded px-2 py-1">
                      <span className="text-zinc-400 font-mono">{model}</span>
                      <span className="text-zinc-300">${price.toFixed(2)}</span>
                    </div>
                  ))}
                </div>
                <p className="text-[9px] text-zinc-600 mt-2">* Estimativa conservadora usando preços Groq/Anthropic 2025. Custo real depende de fallbacks e preços negociados.</p>
              </div>
            </>
          )}
          {!costsLoading && !costsData && (
            <p className="text-zinc-500 text-xs text-center py-6">Nenhum dado de custo disponível para o período.</p>
          )}
        </div>
      </div>
    </div>
  )
}
