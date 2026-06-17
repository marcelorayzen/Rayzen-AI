'use client'

import type { SynthesisArtifact } from '../page'
import { HelpTip } from './HelpTip'

interface SynthesisModalProps {
  synthesisArtifacts: SynthesisArtifact[]
  synthesisLoading: boolean
  synthesizing: boolean
  onSynthesizeCurrent: () => void
  onClose: () => void
}

export function SynthesisModal({ synthesisArtifacts, synthesisLoading, synthesizing, onSynthesizeCurrent, onClose }: SynthesisModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/70" onClick={onClose} />
      <div className="relative z-50 w-full max-w-xl bg-zinc-900 border border-zinc-800 rounded-2xl p-6 mx-4 max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold flex items-center gap-1.5">
            Síntese de sessões
            <HelpTip title="Síntese e Checkpoint" side="bottom">
              <strong>Sintetizar sessão atual</strong> → extrai decisões, next steps e aprendizados da conversa ativa.<br /><br />
              <strong>Checkpoint</strong> (botão ⟳ no HUD) → síntese mais completa que também atualiza ProjectState e o Universe.<br /><br />
              Use Checkpoint ao fechar uma sessão com código real modificado.
            </HelpTip>
          </h2>
          <div className="flex items-center gap-3">
            <button
              onClick={onSynthesizeCurrent}
              disabled={synthesizing}
              className="text-xs bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white px-3 py-1.5 rounded-lg transition-colors"
            >
              {synthesizing ? 'Sintetizando…' : 'Sintetizar sessão atual'}
            </button>
            <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 text-xs">fechar</button>
          </div>
        </div>
        <div className="overflow-y-auto flex-1 space-y-4">
          {synthesisLoading && <p className="text-zinc-500 text-xs text-center py-4">Carregando…</p>}
          {!synthesisLoading && synthesisArtifacts.length === 0 && (
            <p className="text-zinc-500 text-xs text-center py-4">Nenhuma síntese ainda. Clique em &quot;Sintetizar sessão atual&quot; para começar.</p>
          )}
          {synthesisArtifacts.map((a) => (
            <div key={a.id} className="border border-zinc-800 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-zinc-500 font-mono">{new Date(a.createdAt).toLocaleString('pt-BR')}</span>
                  {a.type === 'checkpoint' && (
                    <span className="text-[9px] bg-amber-900 text-amber-300 px-1.5 py-0.5 rounded-full font-medium">checkpoint</span>
                  )}
                  {a.content.confidence && (
                    <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium ${
                      a.content.confidence === 'high' ? 'bg-emerald-900 text-emerald-300' :
                      a.content.confidence === 'medium' ? 'bg-zinc-700 text-zinc-300' :
                      'bg-zinc-800 text-zinc-500'
                    }`}>{a.content.confidence}</span>
                  )}
                </div>
                <span className="text-[10px] text-zinc-600 font-mono truncate ml-2">{a.sessionId.slice(0, 8)}…</span>
              </div>
              <p className="text-xs text-zinc-300">{a.content.summary}</p>
              {a.content.decisions.length > 0 && (
                <div>
                  <p className="text-[10px] font-semibold text-indigo-400 mb-1">Decisões</p>
                  <ul className="space-y-0.5">{a.content.decisions.map((d, i) => <li key={i} className="text-xs text-zinc-400">· {d}</li>)}</ul>
                </div>
              )}
              {a.content.next_steps.length > 0 && (
                <div>
                  <p className="text-[10px] font-semibold text-amber-400 mb-1">Próximos passos</p>
                  <ul className="space-y-0.5">{a.content.next_steps.map((s, i) => <li key={i} className="text-xs text-zinc-400">· {s}</li>)}</ul>
                </div>
              )}
              {a.content.learnings.length > 0 && (
                <div>
                  <p className="text-[10px] font-semibold text-emerald-400 mb-1">Aprendizados</p>
                  <ul className="space-y-0.5">{a.content.learnings.map((l, i) => <li key={i} className="text-xs text-zinc-400">· {l}</li>)}</ul>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
