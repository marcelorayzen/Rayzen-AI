'use client'

import type { QuickCaptureIntent } from '../page'
import { HelpTip } from './HelpTip'

const INTENT_CONFIG: Record<QuickCaptureIntent, { label: string; color: string }> = {
  decision:  { label: 'Decisão',   color: 'bg-indigo-600 text-white' },
  idea:      { label: 'Ideia',     color: 'bg-emerald-600 text-white' },
  problem:   { label: 'Problema',  color: 'bg-red-600 text-white' },
  reference: { label: 'Referência', color: 'bg-zinc-600 text-white' },
}

interface QuickCaptureModalProps {
  quickCaptureIntent: QuickCaptureIntent
  quickCaptureText: string
  quickCaptureSaving: boolean
  onIntentChange: (intent: QuickCaptureIntent) => void
  onTextChange: (text: string) => void
  onSubmit: () => void
  onClose: () => void
}

export function QuickCaptureModal({
  quickCaptureIntent, quickCaptureText, quickCaptureSaving,
  onIntentChange, onTextChange, onSubmit, onClose,
}: QuickCaptureModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/70" onClick={onClose} />
      <div className="relative z-50 w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-2xl p-5 mx-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold flex items-center gap-1.5">
            Captura rápida
            <HelpTip title="O que é a captura rápida?" side="bottom">
              Registra decisões, ideias, problemas e referências no timeline do projeto. Fica visível no painel de Atividade e alimenta o contexto do Rayzen.
              <br /><br />
              <strong>Decisão</strong> → registra como evento tipo "decision".<br />
              <strong>Ideia / Problema / Referência</strong> → registra como "note" com intent.
            </HelpTip>
          </h2>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 text-xl leading-none">×</button>
        </div>
        <div className="flex gap-1.5 mb-4">
          {(Object.keys(INTENT_CONFIG) as QuickCaptureIntent[]).map(intent => (
            <button
              key={intent}
              onClick={() => onIntentChange(intent)}
              className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                quickCaptureIntent === intent ? INTENT_CONFIG[intent].color : 'bg-zinc-800 text-zinc-500 hover:text-zinc-300'
              }`}
            >
              {INTENT_CONFIG[intent].label}
            </button>
          ))}
        </div>
        <textarea
          value={quickCaptureText}
          onChange={(e) => onTextChange(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) onSubmit() }}
          placeholder={
            quickCaptureIntent === 'decision' ? 'O que foi decidido?' :
            quickCaptureIntent === 'idea' ? 'Qual é a ideia?' :
            quickCaptureIntent === 'problem' ? 'Qual é o problema encontrado?' :
            'URL ou referência a guardar'
          }
          rows={4}
          autoFocus
          className="w-full bg-zinc-800 rounded-xl px-4 py-3 text-sm text-zinc-100 placeholder:text-zinc-600 outline-none focus:ring-1 focus:ring-zinc-600 resize-none mb-3"
        />
        <button
          onClick={onSubmit}
          disabled={quickCaptureSaving || !quickCaptureText.trim()}
          className="w-full bg-zinc-100 text-zinc-900 rounded-lg py-2 text-sm font-medium disabled:opacity-40 hover:bg-white transition-colors"
        >
          {quickCaptureSaving ? 'Salvando…' : 'Registrar (⌘ + Enter)'}
        </button>
      </div>
    </div>
  )
}
