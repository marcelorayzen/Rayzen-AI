'use client'

import { useState } from 'react'

interface ClarificationCardProps {
  gateId:    string
  question:  string
  stepTitle?: string
  acting:    boolean
  onAnswer:  (gateId: string, answer: string) => void
  onReject:  (gateId: string) => void
}

export function ClarificationCard({ gateId, question, stepTitle, acting, onAnswer, onReject }: ClarificationCardProps) {
  const [answer, setAnswer] = useState('')

  const submit = () => {
    if (!answer.trim() || acting) return
    onAnswer(gateId, answer.trim())
    setAnswer('')
  }

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 10,
      paddingTop: 8, borderTop: '1px solid var(--hud-border)',
    }}>
      {/* tipo + step */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 4, background: 'rgba(0,212,255,0.12)', border: '1px solid rgba(0,212,255,0.3)', color: 'var(--hud-cyan)' }}>
          esclarecimento
        </span>
        {stepTitle && <span style={{ fontSize: 11, color: 'var(--hud-dim)' }}>step: {stepTitle}</span>}
      </div>

      {/* pergunta */}
      <div style={{ fontSize: 13, lineHeight: 1.5, color: 'var(--hud-text)' }}>{question}</div>

      {/* input de resposta */}
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          className="hud-input"
          style={{ flex: 1, fontSize: 13 }}
          placeholder="sua resposta…"
          value={answer}
          disabled={acting}
          onChange={(e) => setAnswer(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() } }}
          autoFocus
        />
        <button
          className="hud-btn hud-btn-primary"
          disabled={acting || !answer.trim()}
          onClick={submit}
          style={{ whiteSpace: 'nowrap' }}
        >
          {acting ? 'enviando…' : 'responder e retomar'}
        </button>
      </div>

      {/* rejeitar */}
      <button
        className="hud-btn"
        style={{ alignSelf: 'flex-start', fontSize: 11, color: '#ef4444' }}
        disabled={acting}
        onClick={() => onReject(gateId)}
      >
        cancelar step
      </button>
    </div>
  )
}
