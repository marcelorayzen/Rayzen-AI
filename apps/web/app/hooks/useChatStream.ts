'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { API_URL } from '../../lib/api-url'
import { authHeaders } from '../../lib/api-client'

export interface Message {
  role: 'user' | 'assistant'
  content: string
  module?: string
}

export interface Session {
  sessionId: string
  messages: number
  lastActivity: string
  title: string
}

export type WorkMode = 'implementation' | 'debugging' | 'architecture' | 'study' | 'review'

function createSessionId() {
  return globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function'
    ? globalThis.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export function useChatStream(activeProjectId: string | null) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [sessionId, setSessionId] = useState('')
  const [sessionTokens, setSessionTokens] = useState(0)
  const [dailyTokens, setDailyTokens] = useState<number | null>(null)
  const [playingIndex, setPlayingIndex] = useState<number | null>(null)
  const [autoVoice, setAutoVoice] = useState(false)
  const [recording, setRecording] = useState(false)
  const [transcribing, setTranscribing] = useState(false)
  const [workMode, setWorkMode] = useState<WorkMode | null>(null)
  const [sessions, setSessions] = useState<Session[]>([])
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [loadingSession, setLoadingSession] = useState<string | null>(null)
  const [deletingSession, setDeletingSession] = useState<string | null>(null)

  const audioRef = useRef<HTMLAudioElement | null>(null)
  const autoVoiceRef = useRef(false)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const tokenQueueRef = useRef<string[]>([])
  const drainActiveRef = useRef(false)
  const shouldAutoScrollRef = useRef(true)
  const submitMessageRef = useRef<(text: string) => void>(() => {})
  const bottomRef = useRef<HTMLDivElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setSessionId(createSessionId())
  }, [])

  useEffect(() => {
    fetch(`${API_URL}/sessions/tokens`, { headers: authHeaders() })
      .then(r => r.json())
      .then(d => setDailyTokens((d as { last24h?: { tokens?: number } }).last24h?.tokens ?? 0))
      .catch(() => null)
  }, [])

  useEffect(() => {
    const saved = localStorage.getItem('rayzen_auto_voice')
    if (saved === 'true') {
      setAutoVoice(true)
      autoVoiceRef.current = true
    }
  }, [])

  useEffect(() => {
    autoVoiceRef.current = autoVoice
    localStorage.setItem('rayzen_auto_voice', autoVoice ? 'true' : 'false')
  }, [autoVoice])

  const drainQueue = useCallback(() => {
    if (drainActiveRef.current) return
    drainActiveRef.current = true
    const tick = () => {
      const token = tokenQueueRef.current.shift()
      if (token === undefined) { drainActiveRef.current = false; return }
      setMessages(prev => {
        const updated = [...prev]
        const last = updated[updated.length - 1]
        updated[updated.length - 1] = { ...last, content: last.content + token }
        return updated
      })
      setTimeout(tick, 18)
    }
    tick()
  }, [])

  const playAudio = useCallback(async (text: string, index: number, force = false) => {
    if (!force && playingIndex === index) {
      audioRef.current?.pause()
      setPlayingIndex(null)
      return
    }
    const spokenText = text
      .replace(/\n?\[DOC_PENDING:[A-Za-z0-9+/=]*\]/g, '')
      .replace(/\n?\[ACTION_PENDING:[A-Za-z0-9+/=]*\]/g, '')
      .trim()
    if (!spokenText) return
    setPlayingIndex(index)
    try {
      const res = await fetch(`${API_URL}/voice/synthesize`, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ text: spokenText }),
      })
      if (!res.ok) throw new Error('TTS falhou')
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      if (audioRef.current) {
        audioRef.current.pause()
        URL.revokeObjectURL(audioRef.current.src)
      }
      const audio = new Audio(url)
      audioRef.current = audio
      audio.onended = () => setPlayingIndex(null)
      audio.onerror = () => setPlayingIndex(null)
      await audio.play()
    } catch { setPlayingIndex(null) }
  }, [playingIndex])

  const sendMessage = useCallback(async (userMessage: string) => {
    if (!userMessage.trim() || loading) return
    shouldAutoScrollRef.current = true
    setInput('')
    setMessages(prev => [...prev, { role: 'user', content: userMessage }])
    setLoading(true)
    try {
      const res = await fetch(`${API_URL}/orchestrate/stream`, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ prompt: userMessage, sessionId, ...(activeProjectId ? { projectId: activeProjectId } : {}), ...(workMode ? { workMode } : {}) }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const reader = res.body?.getReader()
      const decoder = new TextDecoder()
      let currentModule = ''
      let buffer = ''
      let assistantText = ''
      setMessages(prev => [...prev, { role: 'assistant', content: '', module: '' }])
      while (reader) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          if (line.startsWith('event: ')) continue
          if (!line.startsWith('data: ')) continue
          let data: Record<string, unknown>
          try { data = JSON.parse(line.slice(6)) as Record<string, unknown> } catch { continue }
          if (typeof data.module === 'string') currentModule = data.module
          if (data.text !== undefined) {
            assistantText += data.text as string
            if (currentModule) {
              setMessages(prev => {
                const updated = [...prev]
                updated[updated.length - 1] = { ...updated[updated.length - 1], module: currentModule }
                return updated
              })
            }
            tokenQueueRef.current.push(data.text as string)
            drainQueue()
          }
          if (typeof data.tokensUsed === 'number' && data.tokensUsed > 0) {
            setSessionTokens(prev => prev + (data.tokensUsed as number))
            setDailyTokens(prev => (prev ?? 0) + (data.tokensUsed as number))
          }
          if (typeof data.message === 'string' && !data.text) {
            setMessages(prev => {
              const updated = [...prev]
              updated[updated.length - 1] = { ...updated[updated.length - 1], content: `Erro: ${data.message as string}` }
              return updated
            })
          }
        }
      }
      if (autoVoiceRef.current && assistantText.trim()) {
        setTimeout(() => {
          setMessages(prev => {
            const index = prev.length - 1
            const last = prev[index]
            if (last?.role === 'assistant') void playAudio(last.content || assistantText, index, true)
            return prev
          })
        }, 250)
      }
    } catch (err) {
      const errMsg = `Erro: ${err instanceof Error ? err.message : 'desconhecido'}`
      setMessages(prev => {
        const updated = [...prev]
        const last = updated[updated.length - 1]
        if (last?.role === 'assistant' && !last.content) {
          updated[updated.length - 1] = { ...last, content: errMsg }
          return updated
        }
        return [...prev, { role: 'assistant', content: errMsg }]
      })
    } finally { setLoading(false) }
  }, [loading, sessionId, activeProjectId, workMode, drainQueue, playAudio])

  useEffect(() => {
    submitMessageRef.current = sendMessage
  }, [sendMessage])

  const toggleRecording = useCallback(async () => {
    if (recording) { mediaRecorderRef.current?.stop(); return }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4'
      const mediaRecorder = new MediaRecorder(stream, { mimeType })
      mediaRecorderRef.current = mediaRecorder
      chunksRef.current = []
      mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data) }
      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop())
        setRecording(false)
        setTranscribing(true)
        const blob = new Blob(chunksRef.current, { type: mimeType })
        const formData = new FormData()
        formData.append('file', blob, `audio.${mimeType.includes('webm') ? 'webm' : 'mp4'}`)
        try {
          const res = await fetch(`${API_URL}/voice/transcribe`, {
            method: 'POST',
            headers: authHeaders(),
            body: formData,
          })
          if (!res.ok) throw new Error('STT falhou')
          const data = await res.json() as { text: string }
          if (data.text) submitMessageRef.current(data.text)
        } catch (err) { console.error('STT error:', err) }
        finally { setTranscribing(false) }
      }
      mediaRecorder.start()
      setRecording(true)
    } catch (err) { console.error('Microfone error:', err) }
  }, [recording])

  const loadSessions = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/sessions`, { headers: authHeaders() })
      const data = await res.json()
      setSessions(Array.isArray(data) ? data as Session[] : [])
    } catch { /* silencioso */ }
  }, [])

  const openSidebar = useCallback(() => {
    setSidebarOpen(true)
    loadSessions()
  }, [loadSessions])

  const loadSession = useCallback(async (sid: string) => {
    if (loadingSession) return
    setLoadingSession(sid)
    try {
      const res = await fetch(`${API_URL}/sessions/${sid}/messages`, { headers: authHeaders() })
      const data = await res.json() as Array<{ role: string; content: string; module: string | null }>
      const loaded: Message[] = data.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content, module: m.module ?? undefined }))
      setMessages(loaded)
      setSessionId(sid)
      setSessionTokens(0)
      setSidebarOpen(false)
    } catch { /* silencioso */ }
    finally { setLoadingSession(null) }
  }, [loadingSession])

  const deleteSession = useCallback(async (sid: string, e: React.MouseEvent) => {
    e.stopPropagation()
    if (deletingSession) return
    setDeletingSession(sid)
    try {
      await fetch(`${API_URL}/sessions/${sid}`, { method: 'DELETE', headers: authHeaders() })
      setSessions(prev => prev.filter(s => s.sessionId !== sid))
      if (sid === sessionId) {
        setMessages([])
        setSessionId(createSessionId())
        setSessionTokens(0)
      }
    } catch { /* silencioso */ }
    finally { setDeletingSession(null) }
  }, [deletingSession, sessionId])

  const newChat = useCallback(() => {
    setMessages([])
    setSessionId(createSessionId())
    setSessionTokens(0)
    setSidebarOpen(false)
  }, [])

  return {
    messages, setMessages,
    input, setInput,
    loading,
    sessionId, setSessionId,
    sessionTokens, setSessionTokens,
    dailyTokens, setDailyTokens,
    playingIndex,
    autoVoice, setAutoVoice,
    recording,
    transcribing,
    workMode, setWorkMode,
    sessions,
    sidebarOpen, setSidebarOpen,
    loadingSession,
    deletingSession,
    bottomRef,
    messagesContainerRef,
    shouldAutoScrollRef,
    submitMessageRef,
    drainQueue,
    playAudio,
    sendMessage,
    toggleRecording,
    loadSessions,
    openSidebar,
    loadSession,
    deleteSession,
    newChat,
  }
}
