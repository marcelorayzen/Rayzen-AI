'use client'

import type { Dispatch, SetStateAction } from 'react'
import type { SuccessCriteria } from '../hooks/useGoalGraph'

interface GoalKpi { metric: string; target: string; current?: string; unit: string }

interface GoalFormModalProps {
  editingGoalId: string | null
  goalTitle: string
  setGoalTitle: (value: string) => void
  goalDesc: string
  setGoalDesc: (value: string) => void
  goalTargetDate: string
  setGoalTargetDate: (value: string) => void
  goalCriteria: SuccessCriteria[]
  setGoalCriteria: Dispatch<SetStateAction<SuccessCriteria[]>>
  goalKpis: GoalKpi[]
  setGoalKpis: Dispatch<SetStateAction<GoalKpi[]>>
  savingGoal: boolean
  saveGoal: () => void
  onClose: () => void
}

export function GoalFormModal({
  editingGoalId, goalTitle, setGoalTitle, goalDesc, setGoalDesc, goalTargetDate, setGoalTargetDate,
  goalCriteria, setGoalCriteria, goalKpis, setGoalKpis, savingGoal, saveGoal, onClose,
}: GoalFormModalProps) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      <div className="fixed inset-0 bg-black/80" onClick={onClose} />
      <div className="relative bg-zinc-900 border border-zinc-700 rounded-2xl w-full max-w-lg max-h-[85vh] flex flex-col shadow-2xl mx-4">
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
          <span className="text-sm font-semibold text-zinc-200">{editingGoalId ? 'Editar meta do projeto' : 'Definir meta do projeto'}</span>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 text-lg">×</button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          <div>
            <label className="text-xs text-zinc-400 block mb-1">Título *</label>
            <input value={goalTitle} onChange={e => setGoalTitle(e.target.value)} placeholder="ex: Lançar MVP em produção"
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-500" />
          </div>
          <div>
            <label className="text-xs text-zinc-400 block mb-1">Descrição</label>
            <textarea value={goalDesc} onChange={e => setGoalDesc(e.target.value)} rows={2} placeholder="Contexto da meta…"
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-500 resize-none" />
          </div>
          <div>
            <label className="text-xs text-zinc-400 block mb-1">Prazo</label>
            <input type="date" value={goalTargetDate} onChange={e => setGoalTargetDate(e.target.value)}
              className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-zinc-500" />
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs text-zinc-400">Critérios de sucesso</label>
              <button onClick={() => setGoalCriteria(c => [...c, { id: `c-${Date.now()}`, text: '', done: false }])}
                className="text-xs text-zinc-500 hover:text-zinc-300">+ adicionar</button>
            </div>
            <div className="space-y-1.5">
              {goalCriteria.map((c, i) => (
                <div key={c.id} className="flex items-center gap-2">
                  <input value={c.text} onChange={e => setGoalCriteria(prev => prev.map((x, xi) => xi === i ? { ...x, text: e.target.value } : x))}
                    placeholder={`Critério ${i + 1}`}
                    className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-500" />
                  <button onClick={() => setGoalCriteria(prev => prev.filter((_, xi) => xi !== i))} className="text-zinc-600 hover:text-red-400 text-sm">×</button>
                </div>
              ))}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs text-zinc-400">KPIs (opcional)</label>
              <button onClick={() => setGoalKpis(k => [...k, { metric: '', target: '', unit: '' }])}
                className="text-xs text-zinc-500 hover:text-zinc-300">+ KPI</button>
            </div>
            <div className="space-y-1.5">
              {goalKpis.map((k, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <input value={k.metric} onChange={e => setGoalKpis(p => p.map((x, xi) => xi === i ? { ...x, metric: e.target.value } : x))}
                    placeholder="métrica" className="flex-[2] bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-500" />
                  <input value={k.target} onChange={e => setGoalKpis(p => p.map((x, xi) => xi === i ? { ...x, target: e.target.value } : x))}
                    placeholder="meta" className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-500" />
                  <input value={k.unit} onChange={e => setGoalKpis(p => p.map((x, xi) => xi === i ? { ...x, unit: e.target.value } : x))}
                    placeholder="unid." className="w-14 bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-500" />
                  <button onClick={() => setGoalKpis(p => p.filter((_, xi) => xi !== i))} className="text-zinc-600 hover:text-red-400 text-sm">×</button>
                </div>
              ))}
              {goalKpis.length === 0 && (
                <p className="text-[10px] text-zinc-600">Ex: usuários ativos / 100 / usuários</p>
              )}
            </div>
          </div>
        </div>
        <div className="border-t border-zinc-800 px-6 py-3 flex justify-end gap-2">
          <button onClick={onClose} className="text-xs text-zinc-500 hover:text-zinc-300 px-3 py-2">Cancelar</button>
          <button onClick={saveGoal} disabled={savingGoal || !goalTitle.trim()}
            className="bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-xs px-4 py-2 rounded-lg transition-colors">
            {savingGoal ? 'Salvando…' : editingGoalId ? 'Salvar edição' : 'Salvar meta'}
          </button>
        </div>
      </div>
    </div>
  )
}
