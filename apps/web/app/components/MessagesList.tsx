'use client'

import type { RefObject } from 'react'
import ReactMarkdown from 'react-markdown'
import { API_URL } from '../../lib/api-url'
import type { Message, WorkMode } from '../hooks/useChatStream'

const MODULE_LABELS: Record<string, string> = {
  brain:   'memory',
  jarvis:  'execution',
  doc:     'documents',
  content: 'content-engine',
  system:  'system',
}

interface MessagesListProps {
  messagesContainerRef: RefObject<HTMLDivElement | null>
  shouldAutoScrollRef: RefObject<boolean>
  bottomRef: RefObject<HTMLDivElement | null>
  messages: Message[]
  activeProjectId: string | null
  loading: boolean
  playingIndex: number | null
  workMode: WorkMode | null
  sendMessage: (userMessage: string) => void
  playAudio: (text: string, index: number) => void
}

export function MessagesList({
  messagesContainerRef, shouldAutoScrollRef, bottomRef, messages, activeProjectId,
  loading, playingIndex, workMode, sendMessage, playAudio,
}: MessagesListProps) {
  return (
    <div
      ref={messagesContainerRef}
      onScroll={() => {
        const el = messagesContainerRef.current
        if (!el) return
        shouldAutoScrollRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 160
      }}
      className="flex-1 min-h-0 overflow-y-auto px-4 py-6 flex flex-col gap-4 max-w-3xl w-full mx-auto"
    >
      {messages.length === 0 && !activeProjectId && (
        <div className="mt-10 rounded-2xl border border-zinc-800 bg-zinc-900/70 p-5 text-sm text-zinc-300">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">sem projeto ativo</p>
          <h2 className="mt-2 text-base font-semibold text-zinc-100">Recomendação para o primeiro dia</h2>
          <ol className="mt-3 space-y-3 text-zinc-400">
            <li className="flex gap-2">
              <span className="text-cyan-400 font-semibold shrink-0">1.</span>
              <span>Crie o projeto aqui no Rayzen clicando no <span className="text-zinc-200">+</span> — uma página é criada automaticamente no Notion.</span>
            </li>
            <li className="flex gap-2">
              <span className="text-cyan-400 font-semibold shrink-0">2.</span>
              <span>Abra a pasta do projeto no VS Code — o hook vincula automaticamente pelo nome do repositório Git, sem configuração manual.</span>
            </li>
            <li className="flex gap-2">
              <span className="text-cyan-400 font-semibold shrink-0">3.</span>
              <span>Faça um <span className="text-zinc-200">checkpoint manual</span> com uma nota descrevendo o escopo inicial — isso ancora o estado do projeto antes de ter eventos.</span>
            </li>
            <li className="flex gap-2">
              <span className="text-cyan-400 font-semibold shrink-0">4.</span>
              <span>No <span className="text-zinc-200">Goal Graph</span>, crie a primeira meta com critérios de sucesso — é o que vai medir progresso real ao longo do tempo.</span>
            </li>
          </ol>
          <p className="mt-4 text-xs text-zinc-500">
            Cada VS Code aberto em uma pasta diferente envia eventos para o projeto correto automaticamente. Dois projetos em paralelo funcionam sem configuração extra.
          </p>
        </div>
      )}
      {messages.length === 0 && activeProjectId && (
        <div className="hud-empty mt-20">AGUARDANDO INPUT</div>
      )}
      {messages.map((msg, i) => (
        <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
          <div
            className={`max-w-[80%] px-4 py-3 text-sm leading-relaxed ${
              msg.role === 'user' ? 'hud-msg-user' : 'hud-msg-ai'
            }`}
          >
            {msg.role === 'assistant' ? (
              <div className="prose prose-invert prose-sm max-w-none">
                <ReactMarkdown
                  components={{
                    a: ({ href, children }: { href?: string; children?: React.ReactNode }) => {
                      const url = href?.startsWith('/') ? `${API_URL}${href}` : (href ?? '#')
                      const isDownload = href?.startsWith('/documents/download/') ?? false
                      return (
                        <a href={url} target="_blank" rel="noopener noreferrer" download={isDownload || undefined} className="text-indigo-400 underline hover:text-indigo-300">
                          {children}
                        </a>
                      )
                    },
                  }}
                >
                  {msg.content
                    .replace(/\n?\[DOC_PENDING:[A-Za-z0-9+/=]*\]/g, '')
                    .replace(/\n?\[ACTION_PENDING:[A-Za-z0-9+/=]*\]/g, '')
                    .trim()}
                </ReactMarkdown>
              </div>
            ) : (
              msg.content
            )}

            {msg.role === 'assistant' && (
              <div className="mt-2 flex items-center gap-3">
                {msg.content.includes('[ACTION_PENDING:') && (
                  <>
                    <button
                      onClick={() => sendMessage('confirmar')}
                      disabled={loading}
                      className="text-xs bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white px-2 py-1 rounded-md transition-colors"
                    >
                      Confirmar
                    </button>
                    <button
                      onClick={() => sendMessage('cancelar')}
                      disabled={loading}
                      className="text-xs bg-zinc-700 hover:bg-zinc-600 disabled:opacity-40 text-zinc-200 px-2 py-1 rounded-md transition-colors"
                    >
                      Cancelar
                    </button>
                  </>
                )}
                {msg.module && (
                  <span className="text-xs text-zinc-500">módulo: {MODULE_LABELS[msg.module] ?? msg.module}</span>
                )}
                {workMode && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-700 text-zinc-400 font-mono">{workMode}</span>
                )}
                <button
                  onClick={() => playAudio(msg.content, i)}
                  className="text-xs text-zinc-400 hover:text-zinc-200 transition-colors flex items-center gap-1"
                  title={playingIndex === i ? 'Pausar' : 'Ouvir resposta'}
                >
                  {playingIndex === i ? (
                    <span>⏸ pausar</span>
                  ) : (
                    <span>🔊 ouvir</span>
                  )}
                </button>
              </div>
            )}
          </div>
        </div>
      ))}
      {loading && (
        <div className="flex justify-start">
          <div className="hud-msg-ai px-4 py-3">
            <div className="hud-dots">
              <span /><span /><span />
            </div>
          </div>
        </div>
      )}
      <div ref={bottomRef} />
    </div>
  )
}
