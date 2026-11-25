'use client'

import { useEffect, useState } from 'react'
import { API_URL } from '../../lib/api-url'
import { authHeaders } from '../../lib/api-client'
import { toast } from './toast'

/**
 * G6.4 (21/11) — a seção "Rotinas" do modal de trabalhos. A rotina nasce `proposta` (pelo Hub ou
 * pela api) e só dispara depois que uma pessoa aprova AQUI; mesmo ativa, cada disparo é um envelope
 * que aparece em "Aguardando sua aprovação". Aprovar, retomar e testar exigem principal humano no
 * servidor — este botão só funciona com o login da pessoa, nunca com o token do agent.
 */
type Gatilho = { tipo: 'agenda'; intervaloMin: number } | { tipo: 'github'; evento: string }
type Modelo = { titulo: string; objetivo: string; restricoes: string; criterioDePronto: string; detalhes?: string; aprovacao: string }
type Execucao = { id: string; disparadaEm: string; resultado: string; envelopeId: string | null; erro: string | null; origem: Record<string, unknown> }
export type Rotina = {
  id: string
  projectId: string
  nome: string
  status: 'proposta' | 'ativa' | 'pausada'
  gatilho: Gatilho
  modelo: Modelo
  criadaPor: string
  aprovadaPor: string | null
  ultimoDisparoEm: string | null
  createdAt: string
  execucoes: Execucao[]
}

const EVENTOS: Record<string, string> = {
  'pull_request.opened': 'quando um PR é aberto',
  'workflow_run.failure': 'quando o CI falha',
}
const RESULTADOS: Record<string, string> = {
  proposto: 'envelope criado',
  ignorado_duplicado: 'evento repetido, ignorado',
  limite: 'limite de disparos atingido',
  proposta_aberta: 'já havia envelope aberto',
  falhou: 'falhou',
}
const COR_DO_STATUS: Record<Rotina['status'], string> = {
  proposta: 'border-amber-900/60 bg-amber-950/20',
  ativa: 'border-emerald-900/60 bg-emerald-950/20',
  pausada: 'border-zinc-700 bg-zinc-800/40',
}

export function descreverGatilho(g: Gatilho) {
  if (g.tipo === 'agenda') {
    const n = g.intervaloMin
    return n % 60 === 0 ? `a cada ${n / 60} h` : `a cada ${n} min`
  }
  return EVENTOS[g.evento] ?? g.evento
}

export function CartaoDeRotina({ rotina, ocupado, onAcao }: {
  rotina: Rotina
  ocupado: boolean
  onAcao: (acao: 'aprovar' | 'pausar' | 'retomar' | 'testar') => void
}) {
  const m = rotina.modelo
  return (
    <div className={`rounded-xl border p-3 ${COR_DO_STATUS[rotina.status]}`}>
      <p className="text-sm text-zinc-200">{rotina.nome}</p>
      <p className="mt-0.5 text-[11px] text-zinc-500">
        {rotina.status} · {descreverGatilho(rotina.gatilho)} · por {rotina.criadaPor}
        {rotina.aprovadaPor ? ` · aprovada por ${rotina.aprovadaPor}` : ''}
        {rotina.ultimoDisparoEm ? ` · último disparo ${new Date(rotina.ultimoDisparoEm).toLocaleString('pt-BR')}` : ''}
      </p>

      {/* Aprova-se o que se vê: o modelo inteiro do envelope que cada disparo vai criar. */}
      <div className="mt-2 space-y-1 text-[11px] text-zinc-400">
        <p><span className="text-zinc-500">envelope:</span> {m.titulo}</p>
        <p className="whitespace-pre-wrap"><span className="text-zinc-500">objetivo:</span> {m.objetivo}</p>
        <p className="whitespace-pre-wrap"><span className="text-zinc-500">restrições:</span> {m.restricoes}</p>
        <p className="whitespace-pre-wrap"><span className="text-zinc-500">pronto quando:</span> {m.criterioDePronto}</p>
        {m.detalhes && <p className="whitespace-pre-wrap"><span className="text-zinc-500">detalhes:</span> {m.detalhes}</p>}
        <p><span className="text-zinc-500">acompanhamento:</span> {m.aprovacao === 'por_etapa' ? 'para em cada etapa' : 'para só no diff final'}</p>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {rotina.status === 'proposta' && (
          <button disabled={ocupado} onClick={() => onAcao('aprovar')} className="rounded-lg bg-emerald-700 px-3 py-1.5 text-xs text-white disabled:opacity-40">
            Aprovar
          </button>
        )}
        {rotina.status === 'ativa' && (
          <>
            <button disabled={ocupado} onClick={() => onAcao('testar')} className="rounded-lg bg-sky-700 px-3 py-1.5 text-xs text-white disabled:opacity-40">
              Testar agora
            </button>
            <button disabled={ocupado} onClick={() => onAcao('pausar')} className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 disabled:opacity-40">
              Pausar
            </button>
          </>
        )}
        {rotina.status === 'pausada' && (
          <button disabled={ocupado} onClick={() => onAcao('retomar')} className="rounded-lg bg-emerald-700 px-3 py-1.5 text-xs text-white disabled:opacity-40">
            Retomar
          </button>
        )}
      </div>

      <details className="mt-2">
        <summary className="cursor-pointer text-[11px] text-zinc-500">histórico ({rotina.execucoes.length})</summary>
        {rotina.execucoes.length === 0
          ? <p className="mt-1 text-[11px] text-zinc-500">Ainda não disparou.</p>
          : (
            <ul className="mt-1 space-y-1">
              {rotina.execucoes.map((e) => (
                <li key={e.id} className="text-[11px] text-zinc-400">
                  {new Date(e.disparadaEm).toLocaleString('pt-BR')} · {typeof e.origem?.tipo === 'string' ? `${e.origem.tipo} · ` : ''}
                  <span className={e.resultado === 'falhou' ? 'text-rose-400' : e.resultado === 'proposto' ? 'text-emerald-400' : ''}>
                    {RESULTADOS[e.resultado] ?? e.resultado}
                  </span>
                  {e.erro ? ` — ${e.erro}` : ''}
                </li>
              ))}
            </ul>
          )}
      </details>
    </div>
  )
}

/** `projectId` nulo = Geral: mostra as rotinas de todos os projetos, como os pendentes. */
export function HubRotinas({ projectId, onDisparou }: { projectId: string | null; onDisparou: () => void }) {
  const [rotinas, setRotinas] = useState<Rotina[] | null>(null)
  const [acting, setActing] = useState<string | null>(null)

  const carregar = async () => {
    try {
      const q = projectId ? `?projectId=${projectId}` : ''
      const r = await fetch(`${API_URL}/rotinas${q}`, { headers: authHeaders() })
      if (!r.ok) throw new Error('rotinas')
      setRotinas(await r.json())
    } catch {
      setRotinas(null)
      toast.error('Não foi possível carregar as rotinas.')
    }
  }

  useEffect(() => { void carregar() }, [projectId])

  const agir = async (rotina: Rotina, acao: 'aprovar' | 'pausar' | 'retomar' | 'testar') => {
    if (acao === 'aprovar' && !confirm(`Aprovar "${rotina.nome}"? Ela passa a disparar sozinha (${descreverGatilho(rotina.gatilho)}), e cada disparo cria um envelope para você aprovar.`)) return
    setActing(rotina.id)
    try {
      const r = await fetch(`${API_URL}/rotinas/${rotina.id}/${acao}`, { method: 'POST', headers: authHeaders() })
      const corpo = await r.json().catch(() => ({})) as { message?: string; resultado?: string }
      if (!r.ok) throw new Error(corpo.message ?? 'Não foi possível concluir.')
      if (acao === 'testar') {
        if (corpo.resultado === 'proposto') {
          toast.success('Envelope criado — aparece em "Aguardando sua aprovação".')
          onDisparou()
        } else {
          toast.error(`Não disparou: ${RESULTADOS[corpo.resultado ?? ''] ?? corpo.resultado ?? 'motivo desconhecido'}`)
        }
      } else {
        toast.success({ aprovar: 'Rotina aprovada.', pausar: 'Rotina pausada.', retomar: 'Rotina retomada.' }[acao])
      }
      await carregar()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível concluir.')
    } finally {
      setActing(null)
    }
  }

  if (rotinas === null) return null
  return (
    <section>
      <h3 className="mb-2 text-xs font-medium text-zinc-300">Rotinas ({rotinas.length})</h3>
      {rotinas.length === 0
        ? <p className="text-xs text-zinc-500">Nenhuma rotina. Peça uma ao Hub — ela chega aqui como proposta.</p>
        : (
          <div className="space-y-2">
            {rotinas.map((r) => (
              <CartaoDeRotina key={r.id} rotina={r} ocupado={acting !== null} onAcao={(a) => void agir(r, a)} />
            ))}
          </div>
        )}
    </section>
  )
}
