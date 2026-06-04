import { useState, useRef } from 'react'

interface Props {
  sending:     boolean
  onSend:      (text: string) => void
}

type VoiceState = 'idle' | 'recording' | 'processing'

export function VoiceBar({ sending, onSend }: Props) {
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

  return (
    <div className="bottom-bar" style={{ flexDirection: 'column', gap: 6 }}>
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
          placeholder={sending ? 'aguardando resposta…' : 'descreva uma tarefa ou pergunta…'}
          value={value}
          disabled={sending}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit() } }}
          style={{ flex: 1 }}
        />
        <button
          className="btn btn-primary"
          onClick={handleSubmit}
          disabled={!value.trim() || sending}
          style={{ fontSize: 11, flexShrink: 0 }}
        >
          {sending ? '…' : '→'}
        </button>
      </div>
    </div>
  )
}
