'use client'

import { useCallback, useEffect, useState } from 'react'
import { API_URL } from '../../lib/api-url'
import { authHeaders } from '../../lib/api-client'
import { toast } from './toast'

/**
 * S1d (15/11): a pergunta da sessão de código aparece no fio do Hub, logo acima do compositor.
 * Antes ela chegava só pelo Telegram e pelo `/work-panel` — e o Hub, que é o lugar único, não
 * sabia que havia alguém esperando.
 *
 * A lista vem do servidor (`/hub/handoffs/resumo`), presa aos envelopes deste projeto. A resposta
 * usa a mesma rota da web (`/agent/session/:id/answer`), que passa pelo mesmo `PendingReplyService`
 * do Telegram — uma regra só para o que conta como resposta válida.
 */
type Pergunta = {
  sessionId: string
  handoffId: string
  name: string
  pergunta: string
  exigeAprovacao: boolean
  opcoes: string[] | null
  /** Prévia ao vivo da sessão (https), para ver antes de decidir. */
  previa?: string | null
  desde: string
}

const OPCOES_PADRAO = ['Aprovado, continue', 'Rejeitar e corrigir']
const INTERVALO_MS = 20_000

export function PerguntasDaSessao({ projectId }: { projectId: string | null }) {
  const [perguntas, setPerguntas] = useState<Pergunta[]>([])
  const [texto, setTexto] = useState<Record<string, string>>({})
  const [enviando, setEnviando] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    if (!projectId) { setPerguntas([]); return }
    try {
      const r = await fetch(`${API_URL}/hub/handoffs/resumo?projectId=${projectId}`, { headers: authHeaders() })
      if (!r.ok) return
      const corpo = await r.json() as { perguntas?: Pergunta[] }
      setPerguntas(corpo.perguntas ?? [])
    } catch {
      // Falha de rede não apaga uma pergunta já mostrada: some só quando o servidor disser que acabou.
    }
  }, [projectId])

  useEffect(() => {
    void carregar()
    const t = setInterval(() => void carregar(), INTERVALO_MS)
    return () => clearInterval(t)
  }, [carregar])

  const responder = async (p: Pergunta, resposta: string) => {
    if (!resposta.trim()) return
    setEnviando(p.sessionId)
    try {
      const r = await fetch(`${API_URL}/agent/session/${p.sessionId}/answer`, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ reply: resposta.trim() }),
      })
      if (!r.ok) throw new Error('Não foi possível enviar a resposta.')
      toast.success('Resposta enviada. A sessão continua.')
      setPerguntas((lista) => lista.filter((x) => x.sessionId !== p.sessionId))
      setTexto((t) => ({ ...t, [p.sessionId]: '' }))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível enviar a resposta.')
    } finally {
      setEnviando(null)
    }
  }

  if (perguntas.length === 0) return null

  return (
    <div className="mx-auto w-full max-w-3xl space-y-2 px-4 pb-2">
      {perguntas.map((p) => {
        const opcoes = p.exigeAprovacao ? (p.opcoes?.length ? p.opcoes : OPCOES_PADRAO) : []
        const ocupado = enviando === p.sessionId
        return (
          <div key={p.sessionId} className="min-w-0 overflow-hidden rounded-xl border border-violet-800/70 bg-violet-950/30 p-3">
            <p className="text-[11px] font-medium uppercase tracking-wide text-violet-300">
              {p.exigeAprovacao ? 'A sessão parou e pede aprovação' : 'A sessão pergunta'} · {p.name}
            </p>
            {p.previa && (
              // HC6 (23/11): a prévia vem antes das opções, porque é para ver antes de decidir. Abre
              // em outra aba; o fio continua nesta.
              <a
                href={p.previa}
                target="_blank"
                rel="noreferrer"
                className="mt-2 inline-flex items-center gap-1 rounded-lg border border-cyan-700 px-3 py-1.5 text-xs text-cyan-200"
              >
                Abrir prévia ↗
              </a>
            )}
            {/* break-words: caminho e comando longos estouravam a largura no celular (23/11). */}
            <p className="mt-1 max-h-48 overflow-y-auto whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-xs text-zinc-200">{p.pergunta}</p>
            {opcoes.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {opcoes.map((o) => (
                  <button
                    key={o}
                    disabled={ocupado}
                    onClick={() => void responder(p, o)}
                    className="rounded-lg border border-violet-700 px-3 py-1.5 text-xs text-violet-100 disabled:opacity-40"
                  >
                    {o}
                  </button>
                ))}
              </div>
            )}
            <div className="mt-2 flex gap-2">
              <input
                value={texto[p.sessionId] ?? ''}
                onChange={(e) => setTexto((t) => ({ ...t, [p.sessionId]: e.target.value }))}
                onKeyDown={(e) => { if (e.key === 'Enter') void responder(p, texto[p.sessionId] ?? '') }}
                placeholder={opcoes.length ? 'ou escreva outra instrução…' : 'sua resposta…'}
                className="min-w-0 flex-1 rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-100"
              />
              <button
                disabled={ocupado || !(texto[p.sessionId] ?? '').trim()}
                onClick={() => void responder(p, texto[p.sessionId] ?? '')}
                className="rounded-lg bg-violet-700 px-3 py-1.5 text-xs text-white disabled:opacity-40"
              >
                {ocupado ? 'enviando…' : 'Responder'}
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
