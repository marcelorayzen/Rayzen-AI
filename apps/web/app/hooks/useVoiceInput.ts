'use client'

import { useState, useRef, useCallback } from 'react'
import { API_URL } from '../../lib/api-url'
import { authHeaders } from '../../lib/api-client'

type VoiceState = 'idle' | 'recording' | 'transcribing' | 'error'

interface UseVoiceInputReturn {
  state: VoiceState
  start: () => Promise<void>
  stop: () => void
  error: string | null
}

export function useVoiceInput(onTranscript: (text: string) => void): UseVoiceInputReturn {
  const [state, setState] = useState<VoiceState>('idle')
  const [error, setError] = useState<string | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])

  const stop = useCallback(() => {
    recorderRef.current?.stop()
  }, [])

  const start = useCallback(async () => {
    setError(null)
    chunksRef.current = []

    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch {
      setError('Acesso ao microfone negado')
      setState('error')
      return
    }

    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : MediaRecorder.isTypeSupported('audio/webm')
        ? 'audio/webm'
        : 'audio/mp4'

    const recorder = new MediaRecorder(stream, { mimeType })
    recorderRef.current = recorder

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data)
    }

    recorder.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop())
      setState('transcribing')

      const blob = new Blob(chunksRef.current, { type: mimeType })
      const form = new FormData()
      form.append('file', blob, `audio.${mimeType.includes('mp4') ? 'mp4' : 'webm'}`)

      try {
        const res = await fetch(`${API_URL}/voice/transcribe`, {
          method: 'POST',
          headers: authHeaders(),
          body: form,
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json() as { text: string }
        onTranscript(data.text)
        setState('idle')
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Erro na transcrição')
        setState('error')
      }
    }

    recorder.start()
    setState('recording')
  }, [onTranscript])

  return { state, start, stop, error }
}
