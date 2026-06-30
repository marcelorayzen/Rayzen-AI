import { useState } from 'react'

export interface ServiceStatus {
  ok:         boolean
  latencyMs?: number
  error?:     string
  meta?:      Record<string, unknown>
}

export interface InfraHealthReport {
  ok:       boolean
  services: {
    postgres:      ServiceStatus
    redis:         ServiceStatus
    litellm:       ServiceStatus
    api_v2:        ServiceStatus
    mcp:           ServiceStatus
    hook_jwt:      ServiceStatus
    agent_desktop: ServiceStatus
  }
  checkedAt: string
}

const LABELS: Record<string, string> = {
  postgres:      'pg',
  redis:         'redis',
  litellm:       'llm',
  api_v2:        'v2',
  mcp:           'mcp',
  hook_jwt:      'jwt',
  agent_desktop: 'agent',
}

function dot(s: ServiceStatus | undefined): string {
  if (!s)      return '#555'
  if (!s.ok)   return '#f87171'
  if (s.meta?.warning) return '#fbbf24'
  return '#4ade80'
}

function tooltip(key: string, s: ServiceStatus | undefined): string {
  if (!s) return key
  const ms = s.latencyMs != null ? ` (${s.latencyMs}ms)` : ''
  if (!s.ok) return `${key}: ✗ ${s.error ?? 'erro'}${ms}`
  if (s.meta?.warning) return `${key}: ⚠ ${String(s.meta.warning)}`
  return `${key}: ✓${ms}`
}

interface Props {
  report: InfraHealthReport | null
  checkedAgo: number   // seconds ago
}

export function InfraHealth({ report, checkedAgo }: Props) {
  const [expanded, setExpanded] = useState(false)

  const services = report?.services
  const allOk    = report?.ok ?? null

  const dotColor = allOk === null ? '#555' : allOk ? '#4ade80' : '#f87171'

  return (
    <div style={{ fontSize: 10, borderBottom: '1px solid var(--border)', background: 'rgba(0,0,0,0.2)' }}>
      {/* Collapsed row */}
      <div
        onClick={() => setExpanded((v) => !v)}
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '3px 10px', cursor: 'pointer',
          WebkitAppRegion: 'no-drag' as never,
        }}
        title={allOk === null ? 'verificando…' : allOk ? 'todos os serviços ok' : 'algum serviço com problema'}
      >
        {/* Summary dot */}
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: dotColor, display: 'inline-block', flexShrink: 0 }} />

        {/* Service dots */}
        {services && Object.entries(services).map(([key, s]) => (
          <span
            key={key}
            title={tooltip(key, s)}
            style={{ display: 'flex', alignItems: 'center', gap: 2, color: 'var(--dim)' }}
          >
            <span style={{ width: 5, height: 5, borderRadius: '50%', background: dot(s), display: 'inline-block' }} />
            <span style={{ fontSize: 9 }}>{LABELS[key] ?? key}</span>
          </span>
        ))}

        {/* Last check time */}
        <span style={{ marginLeft: 'auto', color: 'var(--dim)', fontSize: 9 }}>
          {report ? `${checkedAgo}s` : '…'}
        </span>

        <span style={{ color: 'var(--dim)', fontSize: 9 }}>{expanded ? '▲' : '▼'}</span>
      </div>

      {/* Expanded detail */}
      {expanded && services && (
        <div style={{ padding: '4px 10px 6px', display: 'flex', flexDirection: 'column', gap: 3 }}>
          {Object.entries(services).map(([key, s]) => (
            <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: dot(s), flexShrink: 0 }} />
              <span style={{ color: 'var(--text2)', width: 44 }}>{key.replace('_', ' ')}</span>
              <span style={{ color: s.ok ? 'var(--dim)' : '#f87171', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {s.ok
                  ? (s.meta?.warning ? String(s.meta.warning) : (s.latencyMs != null ? `${s.latencyMs}ms` : 'ok'))
                  : (s.error ?? 'erro')}
              </span>
            </div>
          ))}
          <div style={{ color: 'var(--dim)', fontSize: 9, marginTop: 2 }}>
            verificado: {report?.checkedAt ? new Date(report.checkedAt).toLocaleTimeString('pt-BR') : '–'}
          </div>
        </div>
      )}
    </div>
  )
}
