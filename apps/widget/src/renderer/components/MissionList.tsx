import { useState } from 'react'
import { Mission, MissionStatus } from '../App'

const STATUS_LABEL: Record<MissionStatus, string> = {
  pending: 'pendente', active: 'ativa', paused: 'pausada',
  done: 'concluída', failed: 'falhou', cancelled: 'cancelada',
}

const STATUS_COLOR: Record<MissionStatus, string> = {
  pending: 'var(--dim)',    active: 'var(--cyan)',   paused: 'var(--yellow)',
  done: 'var(--green)',     failed: 'var(--red)',     cancelled: 'var(--dim)',
}

function progress(steps: Mission['steps']) {
  if (!steps.length) return 0
  const done = steps.filter((s) => s.status === 'done' || s.status === 'skipped').length
  return Math.round((done / steps.length) * 100)
}

function MissionCard({ m, onAction, onWork }: { m: Mission; onAction: (id: string, a: string) => void; onWork: (m: Mission) => void }) {
  const pct   = progress(m.steps)
  const color = STATUS_COLOR[m.status]
  const isRunning = m.status === 'active'

  return (
    <div className="card" style={{
      display: 'flex', flexDirection: 'column', gap: 6,
      borderColor: isRunning ? 'var(--cyan-40)' : undefined,
    }}>
      {/* Title + badge */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
        <div style={{ fontWeight: 600, fontSize: 12, lineHeight: 1.35, flex: 1 }}>
          {m.title.length > 55 ? m.title.slice(0, 55) + '…' : m.title}
        </div>
        <span className={`badge badge-${m.status}`} style={{ flexShrink: 0 }}>{STATUS_LABEL[m.status]}</span>
      </div>

      {/* Objective subtitle */}
      {m.objective && m.objective !== m.title && (
        <div style={{ fontSize: 11, color: 'var(--text2)', lineHeight: 1.4,
          overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical' as never }}>
          {m.objective}
        </div>
      )}

      {/* Progress */}
      {m.steps.length > 0 && (
        <div>
          <div className="progress-bar">
            <div className="progress-fill" style={{ width: `${pct}%`, background: color }} />
          </div>
          <div style={{ fontSize: 10, color: 'var(--dim)', marginTop: 3 }}>
            {m.steps.filter((s) => s.status === 'done').length}/{m.steps.length} steps · {pct}%
          </div>
        </div>
      )}

      {/* Actions */}
      <div style={{ display: 'flex', gap: 5 }}>
        <button className="btn btn-primary" onClick={() => onWork(m)} style={{ fontSize: 11 }}>trabalhar</button>
        {m.status === 'pending'  && <button className="btn" onClick={() => onAction(m.id, 'execute')}  style={{ fontSize: 11 }}>executar</button>}
        {m.status === 'active'   && <button className="btn" onClick={() => onAction(m.id, 'pause')}    style={{ fontSize: 11 }}>pausar</button>}
        {m.status === 'active'   && <button className="btn" onClick={() => onAction(m.id, 'complete')} style={{ fontSize: 11, color: 'var(--green)' }}>concluir</button>}
        {m.status === 'paused'   && <button className="btn" onClick={() => onAction(m.id, 'execute')}  style={{ fontSize: 11 }}>retomar</button>}
        {(m.status === 'pending' || m.status === 'active' || m.status === 'paused') && (
          <button className="btn" onClick={() => onAction(m.id, 'cancel')} style={{ fontSize: 11, color: 'var(--red)' }}>cancelar</button>
        )}
      </div>
    </div>
  )
}

interface Props {
  missions: Mission[]
  filter: 'ativas' | 'todas'
  onAction: (id: string, action: string) => void
  onWork:   (mission: Mission) => void
}

export function MissionList({ missions, filter, onAction, onWork }: Props) {
  const [showHistory, setShowHistory] = useState(false)

  const active  = missions.filter((m) => m.status === 'active')
  const pending = missions.filter((m) => m.status === 'pending')
  const paused  = missions.filter((m) => m.status === 'paused')
  const history = missions.filter((m) => m.status === 'done' || m.status === 'failed' || m.status === 'cancelled')

  const live = [...active, ...pending, ...paused]

  if (missions.length === 0) return (
    <div style={{ color: 'var(--dim)', fontSize: 12, textAlign: 'center', padding: '30px 0' }}>
      Nenhuma missão.<br />
      <span style={{ fontSize: 11 }}>Descreva uma tarefa abaixo ou abra o work-panel.</span>
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {/* Live missions */}
      {live.length === 0 && filter === 'ativas' && (
        <div style={{ color: 'var(--dim)', fontSize: 12, textAlign: 'center', padding: '16px 0' }}>
          Nenhuma missão ativa no momento.
        </div>
      )}

      {live.map((m) => (
        <MissionCard key={m.id} m={m} onAction={onAction} onWork={onWork} />
      ))}

      {/* History toggle */}
      {history.length > 0 && (
        <>
          <button
            onClick={() => setShowHistory((v) => !v)}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--dim)', fontSize: 11, textAlign: 'left',
              padding: '4px 2px', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 4,
            }}
          >
            <span>{showHistory ? '▾' : '▸'}</span>
            histórico ({history.length})
          </button>

          {showHistory && history.map((m) => (
            <MissionCard key={m.id} m={m} onAction={onAction} onWork={onWork} />
          ))}
        </>
      )}
    </div>
  )
}
