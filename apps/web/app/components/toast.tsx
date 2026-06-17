'use client'

import { useEffect, useState } from 'react'

export type ToastKind = 'error' | 'success' | 'info'
export interface ToastItem { id: number; kind: ToastKind; message: string }

type Listener = (toasts: ToastItem[]) => void

// Singleton de módulo — evita prop-drilling / Context e funciona fora de componentes
// (hooks, helpers). <Toaster/> assina; toast.* publica.
let toasts: ToastItem[] = []
const listeners = new Set<Listener>()
let nextId = 1

function emit() { for (const l of listeners) l(toasts) }

function dismiss(id: number) {
  toasts = toasts.filter((t) => t.id !== id)
  emit()
}

function push(kind: ToastKind, message: string, ttl: number) {
  const id = nextId++
  toasts = [...toasts, { id, kind, message }]
  emit()
  if (ttl > 0) setTimeout(() => dismiss(id), ttl)
}

export const toast = {
  error:   (m: string) => push('error', m, 7000),
  success: (m: string) => push('success', m, 4000),
  info:    (m: string) => push('info', m, 4000),
}

const DOT: Record<ToastKind, string> = {
  error:   '#ef4444',
  success: '#22c55e',
  info:    'var(--hud-cyan)',
}

export function Toaster() {
  const [items, setItems] = useState<ToastItem[]>(() => toasts)

  useEffect(() => {
    listeners.add(setItems)
    return () => { listeners.delete(setItems) }
  }, [])

  if (items.length === 0) return null

  return (
    <div style={{ position: 'fixed', bottom: 16, right: 16, zIndex: 1000, display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 360 }}>
      {items.map((t) => (
        <div
          key={t.id}
          className="hud-card"
          style={{ padding: '10px 12px', fontSize: 12, display: 'flex', alignItems: 'flex-start', gap: 8, borderLeft: `2px solid ${DOT[t.kind]}` }}
        >
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: DOT[t.kind], marginTop: 4, flexShrink: 0 }} />
          <span style={{ color: 'var(--hud-text)' }}>{t.message}</span>
          <button
            onClick={() => dismiss(t.id)}
            aria-label="fechar"
            style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--hud-dim)', cursor: 'pointer', fontSize: 14, lineHeight: 1 }}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  )
}
