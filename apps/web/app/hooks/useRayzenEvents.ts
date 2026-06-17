'use client'

import { useEffect, useRef } from 'react'
import { getApiUrl } from '../../lib/api-url'

export interface RayzenEvent {
  type:      'mission_update' | 'approval_gate' | 'mission_created' | 'ping'
  projectId: string
  payload:   unknown
}

/**
 * Resolve a URL do WebSocket (gateway em :3104 path /ws).
 * Prod: defina NEXT_PUBLIC_API_WS_URL (ex.: wss://rayzen.com.br/ws via proxy).
 * Local: derivado do host da API na porta 3104.
 */
function resolveWsUrl(): string | null {
  const explicit = process.env.NEXT_PUBLIC_API_WS_URL
  if (explicit) return explicit
  if (typeof window === 'undefined') return null
  try {
    const api = new URL(getApiUrl())
    const proto = api.protocol === 'https:' ? 'wss:' : 'ws:'
    return `${proto}//${api.hostname}:3104/ws`
  } catch {
    return null
  }
}

/**
 * Assina os eventos do gateway V2 para um projeto. Aditivo e tolerante a falha:
 * se o WS não conseguir conectar (proxy ausente em prod), apenas não dispara —
 * o polling existente continua sendo o fallback. Reconnect com backoff.
 */
export function useRayzenEvents(projectId: string | null, onEvent: (e: RayzenEvent) => void) {
  const onEventRef = useRef(onEvent)
  onEventRef.current = onEvent

  useEffect(() => {
    if (!projectId) return
    const url = resolveWsUrl()
    if (!url) return

    let ws: WebSocket | null = null
    let closed = false
    let retry: ReturnType<typeof setTimeout> | undefined
    let attempts = 0

    const connect = () => {
      if (closed) return
      try {
        ws = new WebSocket(url)
      } catch {
        return // ambiente sem WebSocket — silencioso, polling cobre
      }

      ws.onopen = () => {
        attempts = 0
        ws?.send(JSON.stringify({ type: 'subscribe', projectIds: [projectId] }))
      }
      ws.onmessage = (ev) => {
        try { onEventRef.current(JSON.parse(ev.data as string) as RayzenEvent) } catch { /* ignora malformado */ }
      }
      ws.onerror = () => { ws?.close() }
      ws.onclose = () => {
        if (closed) return
        attempts++
        retry = setTimeout(connect, Math.min(1000 * 2 ** attempts, 30_000)) // backoff até 30s
      }
    }
    connect()

    return () => {
      closed = true
      if (retry) clearTimeout(retry)
      ws?.close()
    }
  }, [projectId])
}
