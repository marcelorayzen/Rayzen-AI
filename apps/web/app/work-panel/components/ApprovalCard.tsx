'use client'

import { useState } from 'react'

/**
 * Card de aprovação por etapa de uma sessão supervisionada (Claude Code).
 * Quando requiresApproval, mostra os botões de decisão; sempre permite resposta livre.
 */
export function ApprovalCard({
  question,
  requiresApproval,
  options,
  busy,
  onReply,
}: {
  question: string
  requiresApproval: boolean
  options: string[]
  busy?: boolean
  onReply: (reply: string) => void
}) {
  const [text, setText] = useState('')

  const send = (value: string) => {
    if (!value.trim() || busy) return
    onReply(value.trim())
    setText('')
  }

  return (
    <div
      className="hud-card"
      style={{
        padding: 14,
        border: requiresApproval ? '1px solid var(--hud-cyan-40)' : '1px solid var(--hud-border-hi)',
        boxShadow: requiresApproval ? '0 0 0 1px var(--hud-cyan-20)' : undefined,
      }}
    >
      <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5, color: requiresApproval ? 'var(--hud-cyan)' : 'var(--hud-text-2)', marginBottom: 6 }}>
        {requiresApproval ? '⏸ etapa concluída — sua aprovação' : '❓ Claude pergunta'}
      </div>
      <div style={{ whiteSpace: 'pre-wrap', fontSize: 13, color: 'var(--hud-text)', marginBottom: 10, maxHeight: 220, overflowY: 'auto' }}>
        {question}
      </div>

      {requiresApproval && options.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
          {options.map((opt, i) => (
            <button
              key={i}
              className={i === 0 ? 'hud-btn hud-btn-primary' : 'hud-btn'}
              style={{ fontSize: 12 }}
              disabled={busy}
              onClick={() => send(opt)}
            >
              {opt}
            </button>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8 }}>
        <input
          className="hud-input"
          style={{ flex: 1 }}
          placeholder={requiresApproval ? 'ou descreva uma modificação…' : 'responder…'}
          value={text}
          disabled={busy}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(text) } }}
        />
        <button className="hud-btn" disabled={busy || !text.trim()} onClick={() => send(text)}>enviar</button>
      </div>
    </div>
  )
}
