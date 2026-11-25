'use client'

import type { DocVersion } from '../page'

interface VersionsModalProps {
  versions: DocVersion[]
  versionsLoading: boolean
  expandedVersion: string | null
  onToggleExpand: (id: string) => void
  onClose: () => void
}

export function VersionsModal({ versions, versionsLoading, expandedVersion, onToggleExpand, onClose }: VersionsModalProps) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      <div className="fixed inset-0 bg-black/80" onClick={onClose} />
      <div className="relative z-[60] w-full max-w-2xl bg-zinc-900 border border-zinc-800 rounded-2xl mx-4 max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
          <h2 className="text-sm font-semibold">Histórico de versões</h2>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 text-xs">fechar</button>
        </div>
        <div className="overflow-y-auto flex-1 px-6 py-4 space-y-3">
          {versionsLoading && <p className="text-zinc-500 text-xs text-center py-8">Carregando…</p>}
          {!versionsLoading && versions.length === 0 && (
            <p className="text-zinc-500 text-xs text-center py-8">Nenhuma versão anterior. O histórico começa na próxima regeneração.</p>
          )}
          {versions.map((v) => (
            <div key={v.id} className="border border-zinc-800 rounded-xl overflow-hidden">
              <button
                onClick={() => onToggleExpand(v.id)}
                className="w-full flex items-center justify-between px-4 py-3 hover:bg-zinc-800 transition-colors text-left"
              >
                <div className="flex items-center gap-3">
                  <span className="text-xs text-zinc-300">{new Date(v.createdAt).toLocaleString('pt-BR')}</span>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                    v.reason === 'force_regenerated' ? 'bg-red-900 text-red-300' : 'bg-zinc-700 text-zinc-400'
                  }`}>{v.reason}</span>
                  <span className="text-[10px] text-zinc-600">{v.sourceIds?.length ?? 0} fontes</span>
                </div>
                <span className="text-zinc-600 text-xs">{expandedVersion === v.id ? '▲' : '▼'}</span>
              </button>
              {expandedVersion === v.id && (
                <div className="border-t border-zinc-800">
                  {v.diff && (
                    <div className="px-4 py-3 border-b border-zinc-800">
                      <p className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wide mb-2">Diff em relação à versão seguinte</p>
                      <pre className="text-[11px] font-mono whitespace-pre-wrap leading-relaxed">
                        {v.diff.split('\n').map((line, i) => (
                          <span key={i} className={`block ${line.startsWith('+') ? 'text-emerald-400' : line.startsWith('-') ? 'text-red-400' : 'text-zinc-500'}`}>
                            {line}
                          </span>
                        ))}
                      </pre>
                    </div>
                  )}
                  <div className="px-4 py-3 max-h-64 overflow-y-auto">
                    <p className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wide mb-2">Conteúdo desta versão</p>
                    <pre className="text-[11px] text-zinc-400 whitespace-pre-wrap font-mono leading-relaxed">{v.content}</pre>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
