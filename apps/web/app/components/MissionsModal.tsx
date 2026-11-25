'use client'

import { useState } from 'react'
import type { Mission, MissionStep, PendingGate } from '../hooks/useMissions'
import { HelpTip } from './HelpTip'

const MISSION_STATUS_STYLE: Record<string, string> = {
  pending:   'bg-zinc-700 text-zinc-300',
  active:    'bg-blue-500/20 text-blue-400',
  paused:    'bg-amber-500/20 text-amber-400',
  done:      'bg-emerald-500/20 text-emerald-400',
  failed:    'bg-red-500/20 text-red-400',
  cancelled: 'bg-zinc-800 text-zinc-500',
}

function MissionStatusBadge({ status }: { status: string }) {
  return (
    <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded shrink-0 ${MISSION_STATUS_STYLE[status] ?? 'bg-zinc-700 text-zinc-300'}`}>
      {status}
    </span>
  )
}

const STEP_ICON: Record<string, { icon: string; color: string }> = {
  pending: { icon: '○', color: 'text-zinc-600' },
  running: { icon: '⟳', color: 'text-blue-400 animate-spin' },
  done:    { icon: '✓', color: 'text-emerald-500' },
  failed:  { icon: '✗', color: 'text-red-500' },
  skipped: { icon: '–', color: 'text-zinc-600' },
}

function MissionStepRow({ step, index }: { step: MissionStep; index: number }) {
  const [open, setOpen] = useState(false)
  const s = STEP_ICON[step.status] ?? STEP_ICON.pending
  const hasOutput = step.output && Object.keys(step.output).length > 0
  return (
    <div className="rounded-lg bg-zinc-800/40">
      <button
        onClick={() => hasOutput && setOpen(o => !o)}
        className={`w-full flex items-start gap-2 px-2.5 py-1.5 text-left ${hasOutput ? 'hover:bg-zinc-800/70 rounded-lg' : 'cursor-default'}`}
      >
        <span className={`mt-0.5 shrink-0 text-xs ${s.color}`}>{s.icon}</span>
        <div className="min-w-0 flex-1">
          <span className="text-xs text-zinc-300 leading-snug">{index + 1}. {step.title}</span>
          <div className="flex items-center gap-2 mt-0.5">
            <span className={`text-[9px] uppercase font-medium px-1 py-px rounded ${
              step.executor === 'skill' ? 'bg-cyan-500/15 text-cyan-400' :
              step.executor === 'human' ? 'bg-amber-500/15 text-amber-400' :
              'bg-violet-500/15 text-violet-400'
            }`}>{step.executor}</span>
            {step.skillId && <span className="text-[9px] font-mono text-zinc-500">{step.skillId}</span>}
            {step.dependsOn.length > 0 && <span className="text-[9px] text-zinc-600">↳ {step.dependsOn.length} dep</span>}
          </div>
        </div>
        {hasOutput && <span className="text-zinc-600 text-[10px] shrink-0 mt-0.5">{open ? '▲' : '▼'}</span>}
      </button>
      {open && hasOutput && (
        <pre className="text-[10px] text-zinc-400 whitespace-pre-wrap font-mono leading-relaxed px-2.5 pb-2 max-h-48 overflow-y-auto">
          {JSON.stringify(step.output, null, 2)}
        </pre>
      )}
    </div>
  )
}

interface MissionsModalProps {
  missions: Mission[]
  missionsLoading: boolean
  selectedMission: Mission | null
  setSelectedMission: (m: Mission | null) => void
  missionDetailLoading: boolean
  missionInput: string
  setMissionInput: (value: string) => void
  missionCreating: boolean
  missionExecuting: boolean
  missionApplyingTemplate: boolean
  missionRouteNote: string | null
  pendingGates: PendingGate[]
  gateActionLoading: boolean
  selectMission: (id: string) => void
  createMission: (content: string) => Promise<void>
  executeMission: (id: string) => void
  applyMissionTemplate: (id: string, templateType: string) => void
  approveGate: (gateId: string) => void
  rejectGate: (gateId: string) => void
  onClose: () => void
  onOpenDocs: () => void
}

export function MissionsModal({
  missions, missionsLoading, selectedMission, setSelectedMission, missionDetailLoading,
  missionInput, setMissionInput, missionCreating, missionExecuting, missionApplyingTemplate, missionRouteNote,
  pendingGates, gateActionLoading,
  selectMission, createMission, executeMission, applyMissionTemplate, approveGate, rejectGate,
  onClose, onOpenDocs,
}: MissionsModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/70" onClick={onClose} />
      <div className="relative z-50 w-full max-w-2xl bg-zinc-900 border border-zinc-800 rounded-2xl mx-4 max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
          <div>
            <p className="text-sm font-semibold flex items-center gap-1.5">
              ◇ Missões <span className="text-[10px] font-mono text-violet-400/80">V2</span>
              <HelpTip title="O que são Missões?" side="bottom">
                Missões são objetivos estruturados. Descreva em linguagem natural — o Router planeja os steps, associa um Specialist e cria ApprovalGates para ações de risco.
                <br /><br />
                <strong>Dica:</strong> após concluir, o Resultado Loop gera síntese + atualiza o Brain automaticamente.
              </HelpTip>
            </p>
            <p className="text-[10px] text-zinc-500">Router classifica e planeja · Workflow DAG executa com Specialist</p>
          </div>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 text-xs">fechar</button>
        </div>

        <div className="overflow-y-auto flex-1 px-6 py-4 space-y-4">
          {/* Criar missão */}
          <div className="space-y-2">
            <textarea
              value={missionInput}
              onChange={(e) => setMissionInput(e.target.value)}
              placeholder="Descreva o objetivo da missão em linguagem natural — o Router planeja os steps."
              rows={2}
              className="w-full bg-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 outline-none focus:ring-1 focus:ring-zinc-600 resize-none"
            />
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] text-zinc-600">POST /v2/route · mode: mission</span>
              <button
                onClick={async () => { await createMission(missionInput); setMissionInput('') }}
                disabled={missionCreating || !missionInput.trim()}
                className="bg-violet-600 hover:bg-violet-500 text-white rounded-lg px-3 py-1.5 text-xs font-medium disabled:opacity-40 transition-colors"
              >
                {missionCreating ? 'Planejando…' : 'Criar missão'}
              </button>
            </div>
            {missionRouteNote && (
              <p className="text-xs bg-red-950 text-red-400 rounded-lg px-3 py-2">{missionRouteNote}</p>
            )}
          </div>

          {/* Detalhe da missão selecionada */}
          {selectedMission ? (
            <div className="border border-zinc-800 rounded-xl">
              <div className="flex items-start justify-between gap-2 px-4 py-3 border-b border-zinc-800">
                <div className="min-w-0">
                  <button onClick={() => setSelectedMission(null)} className="text-[10px] text-zinc-500 hover:text-zinc-300 mb-1">← voltar à lista</button>
                  <p className="text-sm text-zinc-200 leading-snug">{selectedMission.title}</p>
                  <p className="text-[11px] text-zinc-500 mt-0.5 line-clamp-2">{selectedMission.objective}</p>
                </div>
                <div className="flex flex-col items-end gap-1.5 shrink-0">
                  <MissionStatusBadge status={selectedMission.status} />
                  {['pending', 'active'].includes(selectedMission.status) && (
                    <button
                      onClick={() => executeMission(selectedMission.id)}
                      disabled={missionExecuting || selectedMission.steps.length === 0}
                      className="bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg px-2.5 py-1 text-[11px] font-medium disabled:opacity-40 transition-colors"
                      title={selectedMission.steps.length === 0 ? 'Missão sem steps' : 'Executar Workflow DAG'}
                    >
                      {missionExecuting ? 'Executando…' : '▶ Executar'}
                    </button>
                  )}
                </div>
              </div>
              {/* Approval gates pendentes */}
              {pendingGates.length > 0 && (
                <div className="px-4 pt-3 space-y-2">
                  <p className="text-[10px] font-semibold text-amber-400/80 uppercase tracking-wide flex items-center gap-1">
                    ⚠ {pendingGates.length} gate{pendingGates.length > 1 ? 's' : ''} aguardando aprovação
                  </p>
                  {pendingGates.map((gate) => (
                    <div key={gate.id} className="border border-amber-900/40 bg-amber-950/20 rounded-lg px-3 py-2.5 space-y-1.5">
                      <p className="text-xs text-amber-200 leading-snug">{gate.description}</p>
                      <div className="flex items-center gap-2">
                        <span className="text-[9px] uppercase font-medium px-1 py-px rounded bg-amber-500/15 text-amber-400">{gate.type}</span>
                        {gate.expiresAt && (
                          <span className="text-[9px] text-zinc-500">expira {new Date(gate.expiresAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>
                        )}
                      </div>
                      <div className="flex gap-2 pt-0.5">
                        <button
                          onClick={() => approveGate(gate.id)}
                          disabled={gateActionLoading}
                          className="bg-emerald-700 hover:bg-emerald-600 text-white rounded-lg px-2.5 py-1 text-[11px] font-medium disabled:opacity-40 transition-colors"
                        >
                          {gateActionLoading ? '…' : '✓ Aprovar e retomar'}
                        </button>
                        <button
                          onClick={() => rejectGate(gate.id)}
                          disabled={gateActionLoading}
                          className="bg-zinc-700 hover:bg-zinc-600 text-zinc-300 rounded-lg px-2.5 py-1 text-[11px] font-medium disabled:opacity-40 transition-colors"
                        >
                          {gateActionLoading ? '…' : '✗ Rejeitar'}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="px-4 py-3 space-y-1.5">
                {selectedMission.status === 'done' && (
                  <div className="mb-2 flex items-center gap-2 px-1 py-1.5 bg-emerald-950/40 rounded-lg border border-emerald-900/50">
                    <span className="text-emerald-400 text-xs">✓</span>
                    <span className="text-[11px] text-emerald-300">Documentação gerada automaticamente</span>
                    <button
                      onClick={() => { onClose(); onOpenDocs() }}
                      className="ml-auto text-[10px] text-zinc-400 hover:text-zinc-200 underline"
                    >
                      ver docs
                    </button>
                  </div>
                )}
                {selectedMission.steps.length === 0 && (
                  <div className="py-3 space-y-2">
                    <p className="text-xs text-zinc-500 text-center">
                      O Router não gerou steps. Aplique um template:
                    </p>
                    <div className="flex gap-1.5 justify-center flex-wrap">
                      {(['review', 'implementation', 'debugging'] as const).map(tpl => (
                        <button
                          key={tpl}
                          onClick={() => applyMissionTemplate(selectedMission.id, tpl)}
                          disabled={missionApplyingTemplate}
                          className="bg-zinc-700 hover:bg-zinc-600 text-zinc-200 rounded-lg px-2.5 py-1 text-[11px] font-medium disabled:opacity-40 transition-colors capitalize"
                        >
                          {missionApplyingTemplate ? '…' : tpl}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {selectedMission.steps.map((step, i) => (
                  <MissionStepRow key={step.id} step={step} index={i} />
                ))}
              </div>
            </div>
          ) : (
            /* Lista de missões */
            <div className="space-y-2">
              <p className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wide">Missões do projeto</p>
              {missionsLoading && <p className="text-zinc-500 text-xs text-center py-6">carregando…</p>}
              {!missionsLoading && missions.length === 0 && (
                <p className="text-zinc-500 text-xs text-center py-6">Nenhuma missão ainda. Crie a primeira acima.</p>
              )}
              {missions.map((m) => (
                <button
                  key={m.id}
                  onClick={() => selectMission(m.id)}
                  className="w-full text-left border border-zinc-800 hover:border-zinc-700 bg-zinc-900 hover:bg-zinc-800 rounded-xl px-3 py-2.5 transition-colors"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-xs text-zinc-200 leading-snug">{m.title}</span>
                    <MissionStatusBadge status={m.status} />
                  </div>
                  <div className="flex items-center gap-3 mt-1.5">
                    <span className="text-[10px] text-zinc-600">{new Date(m.createdAt).toLocaleString('pt-BR')}</span>
                    <span className="text-[10px] text-zinc-600">{m.steps.length} {m.steps.length === 1 ? 'step' : 'steps'}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
          {missionDetailLoading && <p className="text-zinc-500 text-xs text-center py-2">atualizando detalhe…</p>}
        </div>
      </div>
    </div>
  )
}
