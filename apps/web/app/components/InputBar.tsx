'use client'

import type { Dispatch, RefObject, SetStateAction } from 'react'
import { HelpPanel } from './HelpPanel'
import { BlueprintModal } from './BlueprintModal'

interface BlueprintHistoryItem {
  id: string
  title: string
  source: string
  format: string
  mode: string | null
  wikiPages: string[]
  eventCount: number
  nextSteps: string[]
  warnings: string[]
  createdAt: string
}

interface BlueprintUploadPreview {
  detectedSections: string[]
  suggestedWikiPages: string[]
  suggestedNextSteps: string[]
  risks: string[]
}

interface BlueprintUploadResult {
  ok: boolean
  created: { wikiPages: string[]; events: string[]; nextSteps: string[] }
  warnings: string[]
}

interface InputBarProps {
  activeProjectId: string | null
  blueprintOpen: boolean
  setBlueprintOpen: Dispatch<SetStateAction<boolean>>
  blueprintTab: 'templates' | 'history' | 'upload'
  setBlueprintTab: (tab: 'templates' | 'history' | 'upload') => void
  blueprintCopied: string | null
  setBlueprintCopied: (key: string | null) => void
  blueprintHistory: BlueprintHistoryItem[]
  setBlueprintHistory: (history: BlueprintHistoryItem[]) => void
  blueprintHistoryLoading: boolean
  setBlueprintHistoryLoading: (loading: boolean) => void
  blueprintUploadFileName: string
  setBlueprintUploadFileName: (name: string) => void
  blueprintUploadTitle: string
  setBlueprintUploadTitle: (title: string) => void
  blueprintUploadContent: string
  setBlueprintUploadContent: (content: string) => void
  blueprintUploadPreview: BlueprintUploadPreview | null
  setBlueprintUploadPreview: (preview: BlueprintUploadPreview | null) => void
  blueprintUploadResult: BlueprintUploadResult | null
  setBlueprintUploadResult: (result: BlueprintUploadResult | null) => void
  blueprintUploadLoading: boolean
  setBlueprintUploadLoading: (loading: boolean) => void
  helpOpen: boolean
  setHelpOpen: Dispatch<SetStateAction<boolean>>
  setInput: (value: string) => void
  inputRef: RefObject<HTMLTextAreaElement | null>
  input: string
  loading: boolean
  handleSubmit: (e: React.FormEvent) => void
  submitCurrentInput: () => void
  recording: boolean
  transcribing: boolean
  toggleRecording: () => void
}

export function InputBar({
  activeProjectId, blueprintOpen, setBlueprintOpen, blueprintTab, setBlueprintTab,
  blueprintCopied, setBlueprintCopied, blueprintHistory, setBlueprintHistory,
  blueprintHistoryLoading, setBlueprintHistoryLoading, blueprintUploadFileName, setBlueprintUploadFileName,
  blueprintUploadTitle, setBlueprintUploadTitle, blueprintUploadContent, setBlueprintUploadContent,
  blueprintUploadPreview, setBlueprintUploadPreview, blueprintUploadResult, setBlueprintUploadResult,
  blueprintUploadLoading, setBlueprintUploadLoading, helpOpen, setHelpOpen, setInput, inputRef,
  input, loading, handleSubmit, submitCurrentInput, recording, transcribing, toggleRecording,
}: InputBarProps) {
  return (
    <div className="hud-input-bar shrink-0 px-4 py-4">
      {/* Blueprint modal */}
      {blueprintOpen && (
        <BlueprintModal
          activeProjectId={activeProjectId}
          blueprintTab={blueprintTab}
          setBlueprintTab={setBlueprintTab}
          blueprintCopied={blueprintCopied}
          setBlueprintCopied={setBlueprintCopied}
          blueprintHistory={blueprintHistory}
          setBlueprintHistory={setBlueprintHistory}
          blueprintHistoryLoading={blueprintHistoryLoading}
          setBlueprintHistoryLoading={setBlueprintHistoryLoading}
          blueprintUploadFileName={blueprintUploadFileName}
          setBlueprintUploadFileName={setBlueprintUploadFileName}
          blueprintUploadTitle={blueprintUploadTitle}
          setBlueprintUploadTitle={setBlueprintUploadTitle}
          blueprintUploadContent={blueprintUploadContent}
          setBlueprintUploadContent={setBlueprintUploadContent}
          blueprintUploadPreview={blueprintUploadPreview}
          setBlueprintUploadPreview={setBlueprintUploadPreview}
          blueprintUploadResult={blueprintUploadResult}
          setBlueprintUploadResult={setBlueprintUploadResult}
          blueprintUploadLoading={blueprintUploadLoading}
          setBlueprintUploadLoading={setBlueprintUploadLoading}
          onClose={() => setBlueprintOpen(false)}
        />
      )}

      {/* Help panel */}
      {helpOpen && (
        <div className="max-w-3xl mx-auto mb-3">
          <HelpPanel
            projectId={activeProjectId}
            onFillInput={(cmd) => {
              setInput(cmd)
              setHelpOpen(false)
              requestAnimationFrame(() => inputRef.current?.focus())
            }}
          />
        </div>
      )}
      <form onSubmit={handleSubmit} className="flex gap-2 max-w-3xl mx-auto">
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              submitCurrentInput()
            }
          }}
          placeholder="Digite uma mensagem ou use o microfone…"
          disabled={loading}
          rows={1}
          className="hud-input flex-1 px-4 py-3 disabled:opacity-50"
        />
        <button
          type="button"
          onClick={() => setBlueprintOpen(v => !v)}
          title="Blueprint — templates de planejamento"
          className={`hud-btn px-3 py-3 text-xs font-bold transition-colors ${blueprintOpen ? 'text-sky-300 bg-zinc-700' : 'text-zinc-500 hover:text-sky-400'}`}
        >
          BP
        </button>
        <button
          type="button"
          onClick={() => setHelpOpen(v => !v)}
          title="Comandos rápidos"
          className={`hud-btn px-3 py-3 text-sm font-bold transition-colors ${helpOpen ? 'text-zinc-100 bg-zinc-700' : 'text-zinc-500 hover:text-zinc-300'}`}
        >
          ?
        </button>
        <button
          type="button"
          onClick={toggleRecording}
          disabled={loading || transcribing}
          title={recording ? 'Parar gravação' : transcribing ? 'Transcrevendo…' : 'Gravar áudio'}
          className={`hud-btn ${
            recording
              ? 'hud-btn-danger px-4 py-3'
              : transcribing
              ? 'px-4 py-3 opacity-60'
              : 'px-4 py-3'
          }`}
          style={recording ? {animation:'hud-pulse-red 1s ease-in-out infinite'} : undefined}
        >
          {recording ? '⏹' : transcribing ? '…' : '🎤'}
        </button>
        <button
          type="submit"
          disabled={loading || !input.trim()}
          className="hud-btn hud-btn-primary px-5 py-3"
        >
          Enviar
        </button>
      </form>
    </div>
  )
}
