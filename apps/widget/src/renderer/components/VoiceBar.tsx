import { useState, useRef } from 'react'

interface Props {
  value: string
  onChange: (v: string) => void
  onTranscript: (text: string) => void
}

type VoiceState = 'idle' | 'recording' | 'processing'

export function VoiceBar({ value, onChange, onTranscript }: Props) {
  const [voiceState, setVoiceState] = useState<VoiceState>('idle')
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef   = useRef<Blob[]>([])

  const startRecording = async () => {
    chunksRef.current = []
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch {
      return
    }

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
        onTranscript(text)
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

  return (
    <div className="bottom-bar">
      <button
        className={`voice-btn ${voiceState}`}
        onClick={handleMic}
        disabled={voiceState === 'processing'}
        title={voiceState === 'recording' ? 'parar' : 'gravar'}
      >
        {voiceState === 'recording' ? '⏹' : voiceState === 'processing' ? '…' : '🎙'}
      </button>
      <input
        className="input"
        placeholder="descreva uma tarefa…"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && value.trim()) {
            // TODO: send to Rayzen chat
          }
        }}
      />
    </div>
  )
}
