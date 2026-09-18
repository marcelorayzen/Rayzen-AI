'use client'

import { useSyncExternalStore } from 'react'
import { getHelpTopic } from '../help/registry'

const STORAGE_KEY = 'rayzen_docs_panel_open'

// A preferência mora no localStorage, que não existe no servidor. useSyncExternalStore
// resolve isso sem setState em efeito: hidrata com o snapshot do servidor (fechado) e
// troca para o valor real logo depois, sem divergência de hidratação.
let listeners: Array<() => void> = []

function subscribe(cb: () => void) {
  listeners.push(cb)
  return () => { listeners = listeners.filter((l) => l !== cb) }
}

function getSnapshot(): boolean {
  try { return localStorage.getItem(STORAGE_KEY) === '1' } catch { return false }
}

function getServerSnapshot(): boolean {
  return false
}

function setPanelOpen(next: boolean) {
  try { localStorage.setItem(STORAGE_KEY, next ? '1' : '0') } catch { /* modo privado */ }
  for (const l of listeners) l()
}

/**
 * Painel de ajuda ancorado à direita, por tela.
 *
 * Fica recolhido por padrão e lembra a escolha — quem já conhece a tela não paga
 * espaço por isso, e quem abriu uma vez continua com ele aberto ao navegar.
 *
 * Em telas estreitas vira overlay em vez de empurrar o conteúdo: espremer um
 * dashboard em 320px o torna ilegível justamente quando se está tentando entendê-lo.
 */
export function DocsPanel({ topicId }: { topicId: string }) {
  const open = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
  const toggle = () => setPanelOpen(!open)

  const topic = getHelpTopic(topicId)

  if (!open) {
    return (
      <button
        onClick={toggle}
        title={`Ajuda — ${topic.label}`}
        aria-label={`Abrir ajuda de ${topic.label}`}
        className="fixed right-0 top-1/2 -translate-y-1/2 z-40 px-1.5 py-3 rounded-l-lg text-[10px] font-bold tracking-wider transition-colors"
        style={{
          background: 'var(--hud-card)',
          border: '1px solid var(--hud-border-hi)',
          borderRight: 'none',
          color: 'var(--hud-text-2)',
          writingMode: 'vertical-rl',
        }}
      >
        ajuda
      </button>
    )
  }

  return (
    <aside
      aria-label={`Ajuda — ${topic.label}`}
      className="fixed right-0 top-0 bottom-0 z-40 w-[320px] max-w-[85vw] flex flex-col overflow-hidden"
      style={{ background: 'var(--hud-surface)', borderLeft: '1px solid var(--hud-border-hi)', boxShadow: 'var(--hud-glow)' }}
    >
      <header
        className="flex items-center justify-between gap-2 px-4 py-3 shrink-0"
        style={{ borderBottom: '1px solid var(--hud-border)' }}
      >
        <div className="flex flex-col min-w-0">
          <span className="text-[10px] uppercase tracking-[0.14em]" style={{ color: 'var(--hud-dim)' }}>ajuda</span>
          <span className="text-sm font-semibold truncate" style={{ color: 'var(--hud-text)' }}>{topic.label}</span>
        </div>
        <button
          onClick={toggle}
          aria-label="Fechar ajuda"
          className="text-xs shrink-0 px-2 py-1 rounded transition-colors hover:opacity-80"
          style={{ color: 'var(--hud-dim)' }}
        >
          fechar
        </button>
      </header>

      <div className="overflow-y-auto flex-1 px-4 py-4 flex flex-col gap-4">
        <p className="text-xs leading-relaxed" style={{ color: 'var(--hud-text-2)' }}>{topic.summary}</p>

        <div className="flex flex-col gap-2.5">
          {topic.notes.map((note) => (
            <div key={note.title} className="rounded-lg px-3 py-2.5" style={{ background: 'var(--hud-card)' }}>
              <p className="text-[11px] font-semibold mb-1" style={{ color: 'var(--hud-text)' }}>{note.title}</p>
              <p className="text-[11px] leading-relaxed" style={{ color: 'var(--hud-text-2)' }}>{note.body}</p>
            </div>
          ))}
        </div>

        {topic.mcp && topic.mcp.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <p className="text-[10px] uppercase tracking-[0.14em]" style={{ color: 'var(--hud-dim)' }}>
              no Claude Code
            </p>
            {topic.mcp.map((cmd) => (
              <button
                key={cmd}
                onClick={() => { void navigator.clipboard?.writeText(cmd) }}
                title="Clique para copiar"
                className="text-left text-[10px] font-mono rounded px-2 py-1.5 transition-colors hover:opacity-80 break-all"
                style={{ background: 'var(--hud-elevated)', color: 'var(--hud-text-2)' }}
              >
                {cmd}
              </button>
            ))}
          </div>
        )}
      </div>
    </aside>
  )
}
