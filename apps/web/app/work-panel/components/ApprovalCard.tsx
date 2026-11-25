'use client'

import { useState } from 'react'

const DIFF_SEP = '---DIFF---'

function parseDiff(raw: string): { body: string; diff: string } {
  const idx = raw.indexOf(DIFF_SEP)
  if (idx === -1) return { body: raw, diff: '' }
  return {
    body: raw.slice(0, idx).trimEnd(),
    diff: raw.slice(idx + DIFF_SEP.length).trim(),
  }
}

function DiffLine({ line }: { line: string }) {
  const isAdd = line.startsWith('+') && !line.startsWith('+++')
  const isDel = line.startsWith('-') && !line.startsWith('---')
  const color = isAdd ? '#4ade80' : isDel ? '#f87171' : 'var(--hud-text-2)'
  return <div style={{ color }}>{line}</div>
}

/**
 * Card de aprovação por etapa de uma sessão supervisionada (Claude Code).
 * Quando requiresApproval, mostra botões de decisão e, se presente, o diff git da etapa.
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
  const { body, diff } = parseDiff(question)

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
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      {/* Label */}
      <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5, color: requiresApproval ? 'var(--hud-cyan)' : 'var(--hud-text-2)' }}>
        {requiresApproval ? '⏸ etapa concluída — sua aprovação' : '❓ Claude pergunta'}
      </div>

      {/* Corpo da mensagem */}
      <div style={{ whiteSpace: 'pre-wrap', fontSize: 13, color: 'var(--hud-text)', maxHeight: 200, overflowY: 'auto' }}>
        {body}
      </div>

      {/* Diff git — só aparece no step_completed quando houver mudanças */}
      {diff && (
        <div>
          <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--hud-text-2)', marginBottom: 4 }}>
            📁 mudanças nesta etapa
          </div>
          <pre style={{
            margin: 0, padding: '8px 10px', fontSize: 11, lineHeight: 1.6,
            background: 'var(--hud-bg)', borderRadius: 4,
            maxHeight: 160, overflowY: 'auto', fontFamily: 'monospace',
          }}>
            {diff.split('\n').map((line, i) => <DiffLine key={i} line={line} />)}
          </pre>
        </div>
      )}

      {/* Botões de aprovação */}
      {requiresApproval && options.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
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

      {/* Input de resposta livre */}
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
