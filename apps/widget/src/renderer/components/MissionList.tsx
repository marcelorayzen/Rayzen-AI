import { Mission, MissionStatus } from '../App'

const STATUS_LABEL: Record<MissionStatus, string> = {
  pending: 'pendente', active: 'ativa', paused: 'pausada',
  done: 'concluída', failed: 'falhou', cancelled: 'cancelada',
}

const STATUS_COLOR: Record<MissionStatus, string> = {
  pending: 'var(--dim)', active: 'var(--cyan)', paused: 'var(--yellow)',
  done: 'var(--green)', failed: 'var(--red)', cancelled: 'var(--dim)',
}

function progress(steps: Mission['steps']) {
  if (!steps.length) return 0
  const done = steps.filter((s) => s.status === 'done' || s.status === 'skipped').length
  return Math.round((done / steps.length) * 100)
}

interface Props {
  missions: Mission[]
  onAction: (id: string, action: string) => void
  onWork: (mission: Mission) => void
}

export function MissionList({ missions, onAction, onWork }: Props) {
  const active  = missions.filter((m) => m.status === 'active')
  const pending = missions.filter((m) => m.status === 'pending')
  const rest    = missions.filter((m) => m.status !== 'active' && m.status !== 'pending').slice(0, 3)

  const items = [...active, ...pending, ...rest]

  if (!items.length) return (
    <div style={{ color: 'var(--dim)', fontSize: 12, textAlign: 'center', padding: '20px 0' }}>
      Nenhuma missão ativa.<br />
      <span style={{ fontSize: 11 }}>Abra o work-panel para criar uma.</span>
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {items.map((m) => {
        const pct   = progress(m.steps)
        const color = STATUS_COLOR[m.status]
        return (
          <div key={m.id} className="card" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {/* Title + badge */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
              <div style={{ fontWeight: 600, fontSize: 12, lineHeight: 1.3, flex: 1 }}>{m.title.slice(0, 60)}{m.title.length > 60 ? '…' : ''}</div>
              <span className={`badge badge-${m.status}`}>{STATUS_LABEL[m.status]}</span>
            </div>

            {/* Progress */}
            {m.steps.length > 0 && (
              <div>
                <div className="progress-bar">
                  <div className="progress-fill" style={{ width: `${pct}%`, background: color }} />
                </div>
                <div style={{ fontSize: 10, color: 'var(--dim)', marginTop: 3 }}>
                  {m.steps.filter((s) => s.status === 'done').length}/{m.steps.length} steps
                </div>
              </div>
            )}

            {/* Actions */}
            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
              <button className="btn btn-primary" onClick={() => onWork(m)} style={{ fontSize: 11 }}>
                trabalhar
              </button>
              {m.status === 'pending' && (
                <button className="btn" onClick={() => onAction(m.id, 'execute')} style={{ fontSize: 11 }}>executar</button>
              )}
              {m.status === 'active' && (
                <>
                  <button className="btn" onClick={() => onAction(m.id, 'pause')} style={{ fontSize: 11 }}>pausar</button>
                  <button className="btn" onClick={() => onAction(m.id, 'complete')} style={{ fontSize: 11, color: 'var(--green)' }}>concluir</button>
                </>
              )}
              {m.status === 'paused' && (
                <button className="btn" onClick={() => onAction(m.id, 'execute')} style={{ fontSize: 11 }}>retomar</button>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
