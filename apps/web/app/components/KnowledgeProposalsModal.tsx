'use client'

import { useCallback, useEffect, useState } from 'react'
import { V2_URL } from '../../lib/api-url'
import { authHeaders } from '../../lib/api-client'
import { toast } from './toast'

type KnowledgeType = 'decision' | 'lesson' | 'pattern' | 'constraint' | 'assumption'

interface KnowledgeProposal {
  id: string
  content: string
  knowledgeType: KnowledgeType
  createdAt: string
  producer: string
  producerVersion?: string | null
  source?: { sourceType: string; sourceIdentity: string; capturedBy: string }
}

const TYPE_LABEL: Record<KnowledgeType, string> = {
  decision: 'decisão',
  lesson: 'lição',
  pattern: 'padrão',
  constraint: 'restrição',
  assumption: 'hipótese',
}

interface KnowledgeProposalsModalProps {
  projectId: string
  projectName: string
  onClose: () => void
}

export function KnowledgeProposalsModal({ projectId, projectName, onClose }: KnowledgeProposalsModalProps) {
  const [proposals, setProposals] = useState<KnowledgeProposal[]>([])
  const [loading, setLoading] = useState(true)
  const [actingId, setActingId] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ scopeType: 'project', projectId, status: 'candidate' })
      const response = await fetch(`${V2_URL}/memory/knowledge/proposals?${params}`, { headers: authHeaders() })
      if (!response.ok) throw new Error(String(response.status))
      setProposals(await response.json())
    } catch {
      toast.error('Não foi possível carregar as propostas pendentes.')
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => { void load() }, [load])

  const decide = useCallback(async (proposal: KnowledgeProposal, action: 'approve' | 'reject') => {
    const actionLabel = action === 'approve' ? 'aprovar' : 'rejeitar'
    if (!window.confirm(`Deseja ${actionLabel} esta proposta? Esta decisão será registrada.`)) return
    const reason = action === 'reject'
      ? window.prompt('Motivo da rejeição (opcional):') ?? undefined
      : undefined

    setActingId(proposal.id)
    try {
      const response = await fetch(`${V2_URL}/memory/knowledge/proposals/${proposal.id}/${action}`, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(reason ? { reason } : {}),
      })
      if (!response.ok) throw new Error(String(response.status))
      setProposals((current) => current.filter((item) => item.id !== proposal.id))
      toast.success(action === 'approve'
        ? 'Proposta aprovada e promovida a conhecimento canônico.'
        : 'Proposta rejeitada.')
    } catch {
      toast.error(`Não foi possível ${actionLabel} a proposta.`)
    } finally {
      setActingId(null)
    }
  }, [])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/70" onClick={onClose} />
      <div className="relative z-50 w-full max-w-lg bg-zinc-900 border border-zinc-800 rounded-2xl p-6 mx-4 max-h-[80vh] flex flex-col">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h2 className="text-sm font-semibold text-zinc-200">Propostas de conhecimento</h2>
            <p className="text-xs text-zinc-500 mt-1">{projectName} · exigem sua decisão antes de virar memória canônica.</p>
          </div>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 text-xs">fechar</button>
        </div>

        <div className="overflow-y-auto flex-1 space-y-3 pr-1">
          {loading && <p className="text-zinc-500 text-xs text-center py-8">Carregando propostas…</p>}
          {!loading && proposals.length === 0 && (
            <p className="text-zinc-500 text-xs text-center py-8">Nenhuma proposta pendente neste projeto.</p>
          )}
          {proposals.map((proposal) => (
            <article key={proposal.id} className="rounded-xl bg-zinc-800 border border-zinc-700 p-4">
              <div className="flex items-center justify-between gap-2 mb-2">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-amber-300 bg-amber-950 px-2 py-0.5 rounded-full">
                  candidata · {TYPE_LABEL[proposal.knowledgeType]}
                </span>
                <time className="text-[10px] text-zinc-500">{new Date(proposal.createdAt).toLocaleString('pt-BR')}</time>
              </div>
              <p className={`text-sm text-zinc-200 whitespace-pre-wrap break-words ${expandedId === proposal.id ? '' : 'line-clamp-2'}`}>
                {proposal.content}
              </p>
              <button
                onClick={() => setExpandedId((current) => current === proposal.id ? null : proposal.id)}
                className="mt-2 text-xs text-sky-300 hover:text-sky-200"
                aria-expanded={expandedId === proposal.id}
              >
                {expandedId === proposal.id ? 'ocultar detalhes' : 'abrir e revisar'}
              </button>
              {expandedId === proposal.id && (
                <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-lg bg-zinc-950/60 p-3 text-[11px]">
                  <dt className="text-zinc-500">origem</dt><dd className="text-zinc-300 break-all">{proposal.source?.sourceType ?? 'não informada'}</dd>
                  <dt className="text-zinc-500">identidade</dt><dd className="text-zinc-300 break-all">{proposal.source?.sourceIdentity ?? 'não informada'}</dd>
                  <dt className="text-zinc-500">produtor</dt><dd className="text-zinc-300">{proposal.producer}{proposal.producerVersion ? ` · ${proposal.producerVersion}` : ''}</dd>
                  <dt className="text-zinc-500">capturada por</dt><dd className="text-zinc-300">{proposal.source?.capturedBy ?? 'não informado'}</dd>
                </dl>
              )}
              <div className="flex justify-end gap-2 mt-4">
                <button
                  onClick={() => void decide(proposal, 'reject')}
                  disabled={actingId !== null}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium text-red-300 hover:text-red-200 hover:bg-red-950 disabled:opacity-40"
                >
                  {actingId === proposal.id ? 'decidindo…' : 'rejeitar'}
                </button>
                <button
                  onClick={() => void decide(proposal, 'approve')}
                  disabled={actingId !== null}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium bg-emerald-700 text-white hover:bg-emerald-600 disabled:opacity-40"
                >
                  {actingId === proposal.id ? 'decidindo…' : 'aprovar'}
                </button>
              </div>
            </article>
          ))}
        </div>
      </div>
    </div>
  )
}
