'use client'

import type { Session } from '../hooks/useChatStream'

function formatRelativeTime(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'agora'
  if (mins < 60) return `${mins}min`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  return `${days}d`
}

interface SidebarOverlayProps {
  sessions: Session[]
  sessionId: string
  loadingSession: string | null
  deletingSession: string | null
  newChat: () => void
  loadSession: (sid: string) => void
  deleteSession: (sid: string, e: React.MouseEvent) => void
  onClose: () => void
}

export function SidebarOverlay({
  sessions, sessionId, loadingSession, deletingSession, newChat, loadSession, deleteSession, onClose,
}: SidebarOverlayProps) {
  return (
    <div className="fixed inset-0 z-40 flex">
      <div
        className="fixed inset-0 bg-black/60"
        onClick={onClose}
      />
      <div className="relative z-50 w-72 bg-zinc-900 border-r border-zinc-800 flex flex-col h-full">
        <div className="px-4 py-4 border-b border-zinc-800 flex items-center justify-between">
          <span className="text-sm font-semibold text-zinc-200">Histórico</span>
          <button
            onClick={onClose}
            className="text-zinc-500 hover:text-zinc-300 text-lg leading-none"
          >
            ×
          </button>
        </div>

        <div className="px-3 py-3 border-b border-zinc-800">
          <button
            onClick={newChat}
            className="w-full rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-sm py-2 px-3 text-left transition-colors"
          >
            + Nova conversa
          </button>
        </div>

        <div className="flex-1 overflow-y-auto py-2">
          {sessions.length === 0 && (
            <p className="text-xs text-zinc-600 px-4 py-3">Nenhuma conversa ainda</p>
          )}
          {sessions.map((s) => (
            <div
              key={s.sessionId}
              className={`group relative border-b border-zinc-800/50 ${
                s.sessionId === sessionId ? 'bg-zinc-800' : 'hover:bg-zinc-800'
              } transition-colors`}
            >
              <button
                onClick={() => loadSession(s.sessionId)}
                disabled={loadingSession === s.sessionId}
                className={`w-full text-left px-4 py-3 pr-10 ${loadingSession === s.sessionId ? 'opacity-50' : ''}`}
              >
                <p className="text-sm text-zinc-200 truncate">{s.title}</p>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-xs text-zinc-600">{s.messages} msgs</span>
                  <span className="text-xs text-zinc-700">·</span>
                  <span className="text-xs text-zinc-600">{formatRelativeTime(s.lastActivity ?? '')}</span>
                </div>
              </button>
              <button
                onClick={(e) => deleteSession(s.sessionId, e)}
                disabled={deletingSession === s.sessionId}
                className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 text-zinc-600 hover:text-red-400 transition-all p-1 rounded"
                title="Deletar conversa"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6l-1 14H6L5 6" />
                  <path d="M10 11v6M14 11v6" />
                  <path d="M9 6V4h6v2" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
