'use client'

import { useRef, type Dispatch, type RefObject, type SetStateAction } from 'react'
import type { AnexoNoCompositor } from '../hooks/useAnexosDoHub'
import type { ModoConversa } from '../hooks/useModoConversa'
import { FaixaDaConversa } from './FaixaDaConversa'
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
  /** HC3: anexos do Hub. Sem `anexosHabilitados`, o clipe não aparece (caminho antigo não os envia). */
  anexosHabilitados?: boolean
  anexos?: AnexoNoCompositor[]
  anexosEnviando?: boolean
  onArquivos?: (arquivos: File[]) => void
  onRemoverAnexo?: (idLocal: string) => void
  /** HC7b: modo conversa por voz. Sem ele, o botão "conversar" não aparece. */
  conversa?: ModoConversa
}

export function InputBar({
  activeProjectId, blueprintOpen, setBlueprintOpen, blueprintTab, setBlueprintTab,
  blueprintCopied, setBlueprintCopied, blueprintHistory, setBlueprintHistory,
  blueprintHistoryLoading, setBlueprintHistoryLoading, blueprintUploadFileName, setBlueprintUploadFileName,
  blueprintUploadTitle, setBlueprintUploadTitle, blueprintUploadContent, setBlueprintUploadContent,
  blueprintUploadPreview, setBlueprintUploadPreview, blueprintUploadResult, setBlueprintUploadResult,
  blueprintUploadLoading, setBlueprintUploadLoading, helpOpen, setHelpOpen, setInput, inputRef,
  input, loading, handleSubmit, submitCurrentInput, recording, transcribing, toggleRecording,
  anexosHabilitados = false, anexos = [], anexosEnviando = false, onArquivos, onRemoverAnexo, conversa,
}: InputBarProps) {
  const seletorRef = useRef<HTMLInputElement>(null)
  const temAnexoPronto = anexos.some((a) => a.estado === 'pronto')
  const podeEnviar = !loading && !anexosEnviando && (Boolean(input.trim()) || temAnexoPronto)
  // Colar print (Ctrl+V) e arrastar arquivo usam o mesmo caminho do clipe.
  const receberArquivos = (lista: FileList | null | undefined) => {
    const arquivos = Array.from(lista ?? [])
    if (arquivos.length && anexosHabilitados && onArquivos) onArquivos(arquivos)
  }
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
      {conversa && <FaixaDaConversa conversa={conversa} />}
      {anexosHabilitados && anexos.length > 0 && (
        <ul className="max-w-3xl mx-auto mb-2 flex flex-wrap gap-2" aria-label="Anexos desta mensagem">
          {anexos.map((a) => (
            <li
              key={a.idLocal}
              title={a.estado === 'pronto' ? (a.previa ? `O modelo vai ler: ${a.previa}` : 'sem texto extraível') : a.erro}
              className={`flex items-center gap-2 rounded-lg border px-2 py-1 text-xs ${
                a.estado === 'erro' ? 'border-rose-800 text-rose-300' : a.estado === 'enviando' ? 'border-zinc-700 text-zinc-400' : 'border-sky-800 text-zinc-200'
              }`}
            >
              <span aria-hidden>{a.estado === 'enviando' ? '…' : a.estado === 'erro' ? '!' : '📎'}</span>
              <span className="max-w-[12rem] truncate">{a.nome}</span>
              <span className="text-zinc-500">
                {a.estado === 'enviando' ? 'lendo…' : a.estado === 'erro' ? a.erro : a.truncado ? 'cortado' : `${Math.max(1, Math.round(a.tamanho / 1024))} KB`}
              </span>
              <button type="button" onClick={() => onRemoverAnexo?.(a.idLocal)} aria-label={`Remover ${a.nome}`} className="text-zinc-500 hover:text-zinc-200">×</button>
            </li>
          ))}
        </ul>
      )}
      <form
        onSubmit={handleSubmit}
        onDragOver={(e) => { if (anexosHabilitados) e.preventDefault() }}
        onDrop={(e) => { if (!anexosHabilitados) return; e.preventDefault(); receberArquivos(e.dataTransfer.files) }}
        className="flex gap-2 max-w-3xl mx-auto"
      >
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onPaste={(e) => {
            if (!anexosHabilitados || !e.clipboardData.files.length) return
            e.preventDefault()
            receberArquivos(e.clipboardData.files)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              submitCurrentInput()
            }
          }}
          placeholder={anexosHabilitados ? 'Digite, fale, ou cole um print (Ctrl+V)…' : 'Digite uma mensagem ou use o microfone…'}
          disabled={loading}
          rows={1}
          className="hud-input flex-1 px-4 py-3 disabled:opacity-50"
        />
        {anexosHabilitados && (
          <>
            {/* `image/*` abre também a câmera no celular. */}
            <input
              ref={seletorRef}
              type="file"
              multiple
              accept=".pdf,.txt,.md,.csv,.json,image/png,image/jpeg,image/webp,image/*"
              className="hidden"
              onChange={(e) => { receberArquivos(e.target.files); e.target.value = '' }}
            />
            <button
              type="button"
              onClick={() => seletorRef.current?.click()}
              disabled={loading}
              title="Anexar arquivo, foto ou print (PDF, imagem, texto)"
              aria-label="Anexar arquivo"
              className="hud-btn px-3 py-3 text-sm text-zinc-400 hover:text-sky-300 disabled:opacity-50"
            >
              📎
            </button>
          </>
        )}
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
        {conversa && (
          <button
            type="button"
            onClick={conversa.ligada ? conversa.desligar : conversa.ligar}
            disabled={recording || transcribing}
            title={conversa.ligada ? 'Sair do modo conversa' : 'Conversar por voz, sem tocar na tela'}
            aria-label={conversa.ligada ? 'Sair do modo conversa' : 'Conversar por voz'}
            className={`hud-btn px-4 py-3 ${conversa.ligada ? 'text-emerald-300 bg-zinc-700' : ''}`}
          >
            🗣️
          </button>
        )}
        <button
          type="button"
          onClick={toggleRecording}
          disabled={loading || transcribing || Boolean(conversa?.ligada)}
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
          disabled={!podeEnviar}
          title={anexosEnviando ? 'Esperando os anexos terminarem de subir' : undefined}
          className="hud-btn hud-btn-primary px-5 py-3"
        >
          Enviar
        </button>
      </form>
    </div>
  )
}
