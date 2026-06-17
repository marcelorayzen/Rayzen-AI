'use client'

import type { ProjectState } from '../hooks/useGoalGraph'
import { RISK_COLORS, STAGE_LABELS, planningTitle } from '../page'

interface ProjectStateModalProps {
  projectState: ProjectState
  stateRefreshing: boolean
  onRefresh: () => void
  onClose: () => void
}

export function ProjectStateModal({ projectState, stateRefreshing, onRefresh, onClose }: ProjectStateModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/70" onClick={onClose} />
      <div className="relative z-50 w-full max-w-lg bg-zinc-900 border border-zinc-800 rounded-2xl mx-4 max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
          <div className="flex items-center gap-2">
            <div className={`w-2.5 h-2.5 rounded-full ${RISK_COLORS[projectState.riskLevel]}`} />
            <h2 className="text-sm font-semibold">Estado do projeto</h2>
            <span className="text-xs text-zinc-500">{STAGE_LABELS[projectState.stage] ?? projectState.stage}</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onRefresh}
              disabled={stateRefreshing}
              className="text-xs bg-zinc-700 hover:bg-zinc-600 disabled:opacity-40 text-zinc-200 px-3 py-1.5 rounded-lg transition-colors"
            >
              {stateRefreshing ? 'Atualizando…' : 'Atualizar'}
            </button>
            <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 text-xs">fechar</button>
          </div>
        </div>
        <div className="overflow-y-auto flex-1 px-6 py-4 space-y-4">
          {projectState.objective && (
            <div>
              <p className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wide mb-1">Objetivo atual</p>
              <p className="text-sm text-zinc-200">{projectState.objective}</p>
            </div>
          )}
          {projectState.blockers.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold text-red-400 uppercase tracking-wide mb-1">Bloqueios</p>
              <ul className="space-y-1">{projectState.blockers.map((b, i) => (
                <li key={i} className="text-xs text-zinc-300 flex gap-1"><span className="text-red-500">■</span>{planningTitle(b)}</li>
              ))}</ul>
            </div>
          )}
          {projectState.nextSteps.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold text-amber-400 uppercase tracking-wide mb-1">Próximos passos</p>
              <ul className="space-y-1">{projectState.nextSteps.map((s, i) => (
                <li key={i} className="text-xs text-zinc-300 flex gap-1"><span className="text-amber-500">→</span>{planningTitle(s)}</li>
              ))}</ul>
            </div>
          )}
          {projectState.recentDecisions.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold text-indigo-400 uppercase tracking-wide mb-1">Decisões recentes</p>
              <ul className="space-y-1">{projectState.recentDecisions.map((d, i) => (
                <li key={i} className="text-xs text-zinc-300">· {d}</li>
              ))}</ul>
            </div>
          )}
          {projectState.risks.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold text-orange-400 uppercase tracking-wide mb-1">Riscos</p>
              <ul className="space-y-1">{projectState.risks.map((r, i) => (
                <li key={i} className="text-xs text-zinc-400">· {r}</li>
              ))}</ul>
            </div>
          )}
          {projectState.docGaps.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wide mb-1">Lacunas de documentação</p>
              <ul className="space-y-1">{projectState.docGaps.map((g, i) => (
                <li key={i} className="text-xs text-zinc-500">· {g}</li>
              ))}</ul>
            </div>
          )}
          {projectState.activeFocus && (
            <div className="border border-indigo-800 bg-indigo-950/30 rounded-xl p-3">
              <p className="text-[10px] font-semibold text-indigo-400 uppercase tracking-wide mb-1">Foco ativo</p>
              <p className="text-xs text-zinc-200">{projectState.activeFocus}</p>
              {projectState.definitionOfDone && (
                <p className="text-[10px] text-zinc-500 mt-1">Done: {projectState.definitionOfDone}</p>
              )}
            </div>
          )}
          {projectState.milestones && projectState.milestones.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wide mb-1">Milestones</p>
              <ul className="space-y-1">
                {projectState.milestones.map((m) => (
                  <li key={m.id} className="flex items-center gap-2 text-xs">
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                      m.status === 'done' ? 'bg-emerald-500' :
                      m.status === 'active' ? 'bg-amber-400' : 'bg-zinc-600'
                    }`} />
                    <span className={m.status === 'done' ? 'text-zinc-600 line-through' : 'text-zinc-300'}>{m.title}</span>
                    <span className="text-[9px] text-zinc-600 ml-auto">{m.status}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {projectState.backlog && projectState.backlog.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wide mb-1">Backlog</p>
              <ul className="space-y-1">
                {projectState.backlog.slice(0, 5).map((b) => (
                  <li key={b.id} className="flex items-center gap-2 text-xs">
                    <span className={`text-[9px] px-1.5 py-0.5 rounded font-medium ${
                      b.priority === 'high' ? 'bg-red-900 text-red-300' :
                      b.priority === 'medium' ? 'bg-amber-900 text-amber-300' : 'bg-zinc-700 text-zinc-500'
                    }`}>{b.priority}</span>
                    <span className="text-zinc-400 truncate">{b.title}</span>
                  </li>
                ))}
                {projectState.backlog.length > 5 && (
                  <li className="text-[10px] text-zinc-600">+{projectState.backlog.length - 5} itens</li>
                )}
              </ul>
            </div>
          )}
          <p className="text-[10px] text-zinc-700">Atualizado em {new Date(projectState.updatedAt).toLocaleString('pt-BR')}</p>
        </div>
      </div>
    </div>
  )
}
