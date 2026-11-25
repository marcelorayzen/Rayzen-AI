'use client'

import type { Project } from '../hooks/useProjects'
import type { ActivityEvent, MemoryClassFilter } from '../page'

interface HookHealth { status: string; lastCliEvent: string | null }

function hookLiveBadge(hookHealth: HookHealth) {
  const ts = hookHealth.lastCliEvent ? new Date(hookHealth.lastCliEvent).getTime() : 0
  const ageMin = ts ? Math.floor((Date.now() - ts) / 60000) : Infinity
  const live = ageMin < 10
  const ago = !ts ? 'sem eventos'
    : ageMin < 1 ? 'agora'
    : ageMin < 60 ? `há ${ageMin}min`
    : ageMin < 1440 ? `há ${Math.floor(ageMin / 60)}h`
    : `há ${Math.floor(ageMin / 1440)}d`
  const color = live ? 'bg-emerald-500' : ageMin < 1440 ? 'bg-amber-500' : 'bg-red-500'
  return { live, ago, color }
}

interface ActivityModalProps {
  activeProjectId: string | null
  projects: Project[]
  hookHealth: HookHealth | null
  memoryClassFilter: MemoryClassFilter
  onFilterChange: (cls: MemoryClassFilter) => void
  highSignalOnly: boolean
  onToggleHighSignal: () => void
  activityLoading: boolean
  activityEvents: ActivityEvent[]
  onClose: () => void
}

export function ActivityModal({
  activeProjectId, projects, hookHealth, memoryClassFilter, onFilterChange,
  highSignalOnly, onToggleHighSignal, activityLoading, activityEvents, onClose,
}: ActivityModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/70" onClick={onClose} />
      <div className="relative z-50 w-full max-w-lg bg-zinc-900 border border-zinc-800 rounded-2xl p-6 mx-4 max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold">
              Atividade{activeProjectId && projects.find(p => p.id === activeProjectId) ? ` — ${projects.find(p => p.id === activeProjectId)!.name}` : ''}
            </h2>
            {activeProjectId && hookHealth && (() => {
              const { live, ago, color } = hookLiveBadge(hookHealth)
              return (
                <span
                  title={`Hook ${hookHealth.status} · último evento ${ago}`}
                  className="flex items-center gap-1 text-[10px] text-zinc-400"
                >
                  <span className={`w-2 h-2 rounded-full ${color} ${live ? 'animate-pulse' : ''}`} />
                  {live ? 'ao vivo' : ago}
                </span>
              )
            })()}
          </div>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 text-xs">fechar</button>
        </div>
        <div className="flex gap-1 mb-3 flex-wrap items-center">
          {(['all', 'global', 'consolidated', 'working', 'inbox', 'archive'] as MemoryClassFilter[]).map((cls) => (
            <button
              key={cls}
              onClick={() => onFilterChange(cls)}
              className={`text-[10px] px-2 py-1 rounded-lg font-medium transition-colors ${
                memoryClassFilter === cls
                  ? cls === 'consolidated' ? 'bg-emerald-700 text-white'
                    : cls === 'working'    ? 'bg-amber-700 text-white'
                    : cls === 'archive'    ? 'bg-zinc-600 text-zinc-300'
                    : cls === 'inbox'      ? 'bg-indigo-700 text-white'
                    : cls === 'global'     ? 'bg-sky-700 text-white'
                    : 'bg-zinc-700 text-zinc-200'
                  : 'bg-zinc-800 text-zinc-500 hover:text-zinc-300'
              }`}
            >
              {cls}
            </button>
          ))}
          <button
            onClick={onToggleHighSignal}
            title="Filtrar apenas eventos com sinal semântico"
            className={`ml-auto text-[10px] px-2 py-1 rounded-lg font-medium transition-colors ${
              highSignalOnly ? 'bg-violet-700 text-white' : 'bg-zinc-800 text-zinc-500 hover:text-zinc-300'
            }`}
          >
            ✦ sinal
          </button>
        </div>
        <div className="overflow-y-auto flex-1 space-y-2">
          {activityLoading && <p className="text-zinc-500 text-xs text-center py-4">Carregando…</p>}
          {!activityLoading && activityEvents.length === 0 && (
            <p className="text-zinc-500 text-xs text-center py-4">Nenhum evento registrado ainda.</p>
          )}
          {activityEvents.filter(ev => {
            if (!highSignalOnly) return true
            // Remove eventos de baixo sinal: leituras MCP, tool calls sem intent de source cli
            if (ev.content.startsWith('Read:')) return false
            if (ev.source === 'cli' && !ev.intent && ev.type === 'execution') return false
            return true
          }).map((ev) => {
            const git = (ev.metadata as Record<string, unknown>)?.['git'] as Record<string, unknown> | null
            const evidenceType = typeof ev.metadata?.['evidenceType'] === 'string' ? ev.metadata['evidenceType'] : null
            const evidencePath = typeof ev.metadata?.['path'] === 'string' ? ev.metadata['path'] : null
            return (
              <div key={ev.id} className="flex gap-3 py-2 border-b border-zinc-800 last:border-0">
                <div className="flex flex-col items-center gap-1 min-w-[56px]">
                  <span className="text-[10px] text-zinc-500 font-mono">{ev.source}</span>
                  <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium ${
                    ev.type === 'message'   ? 'bg-indigo-900 text-indigo-300' :
                    ev.type === 'index'     ? 'bg-emerald-900 text-emerald-300' :
                    ev.type === 'execution' ? 'bg-amber-900 text-amber-300' :
                    ev.type === 'decision'  ? 'bg-purple-900 text-purple-300' :
                    'bg-zinc-800 text-zinc-400'
                  }`}>{ev.type}</span>
                  {ev.intent && (
                    <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold ${
                      ev.intent === 'decision'   ? 'bg-purple-900 text-purple-300' :
                      ev.intent === 'problem'    ? 'bg-red-900 text-red-300' :
                      ev.intent === 'checkpoint' ? 'bg-emerald-900 text-emerald-300' :
                      ev.intent === 'idea'       ? 'bg-yellow-900 text-yellow-300' :
                      'bg-zinc-800 text-zinc-500'
                    }`}>{ev.intent}</span>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-zinc-300 truncate">
                    {evidenceType === 'screenshot' ? '📸 ' : ''}
                    {ev.content}
                  </p>
                  <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                    <span className="text-[10px] text-zinc-600">{new Date(ev.ts).toLocaleString('pt-BR')}</span>
                    {ev.project
                      ? <span className="text-[9px] px-1.5 py-0.5 rounded bg-sky-900 text-sky-300 font-medium">{ev.project.name}</span>
                      : <span className="text-[9px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-500 font-medium">global</span>
                    }
                    {ev.memoryClass && ev.memoryClass !== 'inbox' && (
                      <span className={`text-[9px] px-1.5 py-0.5 rounded font-medium ${
                        ev.memoryClass === 'consolidated' ? 'bg-emerald-900 text-emerald-300' :
                        ev.memoryClass === 'working'      ? 'bg-amber-900 text-amber-300' :
                        ev.memoryClass === 'archive'      ? 'bg-zinc-700 text-zinc-500' :
                        'bg-zinc-800 text-zinc-500'
                      }`}>{ev.memoryClass}</span>
                    )}
                    {evidenceType === 'screenshot' && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-cyan-900 text-cyan-300 font-medium">evidência</span>
                    )}
                    {evidencePath && (
                      <span className="text-[10px] font-mono text-zinc-600 truncate max-w-[320px]" title={evidencePath}>
                        {evidencePath}
                      </span>
                    )}
                    {typeof git?.['branch'] === 'string' && (
                      <span className="text-[10px] font-mono text-indigo-400">⎇ {git['branch']}</span>
                    )}
                    {typeof git?.['commitHash'] === 'string' && (
                      <span className="text-[10px] font-mono text-zinc-600">{git['commitHash']}</span>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
