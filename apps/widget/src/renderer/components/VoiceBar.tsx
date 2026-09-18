import { useState, useRef } from 'react'

type ChatMode = 'rayzen' | 'claude'

const MODELS = [
  { id: 'claude-haiku-4-5-20251001', label: 'Haiku',  hint: 'rápido · barato'   },
  { id: 'claude-sonnet-4-6',         label: 'Sonnet', hint: 'equilibrado'        },
  { id: 'claude-opus-4-8',           label: 'Opus',   hint: 'mais capaz · caro'  },
]

interface Props {
  sending:        boolean
  onSend:         (text: string) => void
  chatMode:       ChatMode
  onModeChange:   (mode: ChatMode) => void
  claudeModel:    string
  onModelChange:  (model: string) => void
}

type VoiceState = 'idle' | 'recording' | 'processing'

export function VoiceBar({ sending, onSend, chatMode, onModeChange, claudeModel, onModelChange }: Props) {
  const [voiceState, setVoiceState] = useState<VoiceState>('idle')
  const [value, setValue]           = useState('')
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef   = useRef<Blob[]>([])

  const startRecording = async () => {
    chunksRef.current = []
    let stream: MediaStream
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }) }
    catch { return }

    const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm'
    const rec  = new MediaRecorder(stream, { mimeType: mime })
    recorderRef.current = rec

    rec.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data) }
    rec.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop())
      setVoiceState('processing')
      const blob   = new Blob(chunksRef.current, { type: mime })
      const buffer = await blob.arrayBuffer()
      try {
        const text = await window.rayzen.transcribe(buffer)
        if (text) setValue((prev) => prev ? `${prev} ${text}` : text)
      } catch { /* silencioso */ }
      setVoiceState('idle')
    }
    rec.start()
    setVoiceState('recording')
  }

  const stopRecording = () => recorderRef.current?.stop()

  const handleMic = () => {
    if (voiceState === 'recording') stopRecording()
    else if (voiceState === 'idle') void startRecording()
  }

  const handleSubmit = () => {
    const text = value.trim()
    if (!text || sending) return
    setValue('')
    onSend(text)
  }

  const isClaude = chatMode === 'claude'

  return (
    <div className="bottom-bar" style={{ flexDirection: 'column', gap: 6 }}>
      {/* Mode toggle */}
      <div style={{ display: 'flex', gap: 4, alignSelf: 'flex-start' }}>
        {(['claude', 'rayzen'] as ChatMode[]).map((m) => (
          <button
            key={m}
            onClick={() => onModeChange(m)}
            style={{
              background:  chatMode === m ? (m === 'claude' ? 'var(--cyan)' : 'var(--yellow)') : 'var(--surface)',
              color:       chatMode === m ? '#0a0a10' : 'var(--dim)',
              border:      'none',
              borderRadius: 3,
              padding:     '2px 8px',
              fontSize:    10,
              fontWeight:  chatMode === m ? 700 : 400,
              cursor:      'pointer',
              fontFamily:  'inherit',
              letterSpacing: 0.5,
              textTransform: 'uppercase' as const,
            }}
          >
            {m === 'claude' ? 'Claude' : 'Rayzen'}
          </button>
        ))}
        <span style={{ fontSize: 10, color: 'var(--dim)', alignSelf: 'center', marginLeft: 2 }}>
          {isClaude ? '— API direta' : '— assistente com memória'}
        </span>
      </div>

      {/* Model selector — só aparece no modo Claude */}
      {isClaude && (
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          {MODELS.map((m) => (
            <button
              key={m.id}
              onClick={() => onModelChange(m.id)}
              title={m.hint}
              style={{
                background:   claudeModel === m.id ? 'var(--cyan)' : 'transparent',
                color:        claudeModel === m.id ? '#0a0a10' : 'var(--dim)',
                border:       `1px solid ${claudeModel === m.id ? 'var(--cyan)' : 'var(--border)'}`,
                borderRadius: 3,
                padding:      '1px 7px',
                fontSize:     10,
                fontWeight:   claudeModel === m.id ? 700 : 400,
                cursor:       'pointer',
                fontFamily:   'inherit',
              }}
            >
              {m.label}
            </button>
          ))}
        </div>
      )}

      {/* Input row */}
      <div style={{ display: 'flex', gap: 6, width: '100%' }}>
        <button
          className={`voice-btn ${voiceState}`}
          onClick={handleMic}
          disabled={voiceState === 'processing' || sending}
          title={voiceState === 'recording' ? 'parar' : 'gravar'}
          style={{ flexShrink: 0 }}
        >
          {voiceState === 'recording' ? '⏹' : voiceState === 'processing' ? '…' : '🎙'}
        </button>
        <input
          className="input"
          placeholder={
            sending
              ? isClaude ? 'Claude pensando…' : 'aguardando resposta…'
              : isClaude ? 'pergunta ao Claude (CLI local)…' : 'descreva uma tarefa ou pergunta…'
          }
          value={value}
          disabled={sending}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit() } }}
          style={{
            flex: 1,
            borderColor: isClaude ? 'var(--cyan-40)' : undefined,
          }}
        />
        <button
          className={`btn ${isClaude ? 'btn-primary' : 'btn'}`}
          onClick={handleSubmit}
          disabled={!value.trim() || sending}
          style={{
            fontSize: 11, flexShrink: 0,
            background: isClaude ? 'var(--cyan)' : undefined,
            color:      isClaude ? '#0a0a10' : undefined,
          }}
        >
          {sending ? '…' : '→'}
        </button>
      </div>
    </div>
  )
}
