'use client'

import { useCallback, useEffect, useState } from 'react'
import { API_URL, V2_URL } from '../../lib/api-url'
import { authHeaders } from '../../lib/api-client'
import { EVENTO_TURNO_CONCLUIDO } from '../hooks/useChatStream'
import { CartaoDePendente, type Pendente } from './HubWorkItemsModal'
import { CartaoDeRotina, descreverGatilho, type Rotina } from './HubRotinas'
import { toast } from './toast'

/**
 * HC4 (22/11/2026) — o que o Hub propôs aparece NO FIO, logo acima do compositor, com aprovar ali
 * mesmo: envelopes aguardando aprovação (sessão, projeto) e rotinas propostas. É o mesmo cartão do
 * modal "trabalhos" — inclusive o código do autenticador para alçada crítica —, então a regra de
 * quem aprova o quê não muda; muda só onde a pessoa vê.
 *
 * Recarrega quando um turno termina (o Hub acabou de propor algo) e a cada 30 s. No Geral, como no
 * modal, mostra o que espera aprovação em todos os projetos.
 */
const INTERVALO_MS = 30_000

/** HC4b — proposta de mexer na biblioteca da memória (gaveta 1). */
type PropostaDeMemoria = {
  id: string
  acao: 'guardar' | 'remover'
  titulo: string
  status: 'proposta' | 'indexando'
  sourcePath: string | null
  trechos?: number
  anexo?: { nome: string; caracteres: number; truncado: boolean; originalDisponivel: boolean; previa: string } | null
}

/** HC4b — proposta para o caderno (gaveta 2): o que o Rayzen passa a tratar como verdade. */
type PropostaDeConhecimento = {
  id: string
  content: string
  knowledgeType: 'decision' | 'lesson' | 'pattern' | 'constraint' | 'assumption'
  logicalKey?: string
  producer: string
}
const TIPO_DE_CONHECIMENTO: Record<PropostaDeConhecimento['knowledgeType'], string> = {
  decision: 'decisão', lesson: 'lição', pattern: 'padrão', constraint: 'regra', assumption: 'premissa',
}

function CartaoDeConhecimento({ p, ocupado, onDecidir }: {
  p: PropostaDeConhecimento
  ocupado: boolean
  onDecidir: (aprovar: boolean) => void
}) {
  const revoga = p.content.startsWith('REVOGADO:')
  return (
    <div className="rounded-xl border border-violet-900/60 bg-violet-950/20 p-3">
      <p className="text-sm text-zinc-200">
        {revoga ? '📌 Retirar do caderno' : `📌 Anotar no caderno (${TIPO_DE_CONHECIMENTO[p.knowledgeType]})`}
        {p.logicalKey ? <span className="ml-1 font-mono text-[11px] text-zinc-500">{p.logicalKey}</span> : null}
      </p>
      <p className="mt-1 text-[11px] text-zinc-500">
        aprovado, o Rayzen passa a tratar isto como verdade — se já houver uma entrada com esta chave, ela é substituída (o histórico fica)
      </p>
      <p className="mt-2 whitespace-pre-wrap text-xs text-zinc-300">{p.content}</p>
      <div className="mt-3 flex gap-2">
        <button disabled={ocupado} onClick={() => onDecidir(true)} className="rounded-lg bg-emerald-700 px-3 py-1.5 text-xs text-white disabled:opacity-40">
          Aprovar
        </button>
        <button disabled={ocupado} onClick={() => onDecidir(false)} className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 disabled:opacity-40">
          Rejeitar
        </button>
      </div>
    </div>
  )
}

function CartaoDeMemoria({ p, ocupado, onDecidir }: {
  p: PropostaDeMemoria
  ocupado: boolean
  onDecidir: (aprovar: boolean) => void
}) {
  const guardando = p.status === 'indexando'
  const inteiro = p.anexo && (p.anexo.originalDisponivel || !p.anexo.truncado)
  return (
    <div className="rounded-xl border border-sky-900/60 bg-sky-950/20 p-3">
      <p className="text-sm text-zinc-200">
        {p.acao === 'guardar' ? '🗂️ Guardar na memória do projeto: ' : '🗑️ Remover da memória do projeto: '}{p.titulo}
      </p>
      <p className="mt-0.5 text-[11px] text-zinc-500">
        {p.acao === 'guardar'
          ? (p.anexo
            ? `biblioteca (material de consulta, não regra) · ${inteiro ? 'arquivo inteiro' : `só os ${p.anexo.caracteres.toLocaleString('pt-BR')} caracteres já lidos — o original expirou`}`
            : 'anexo não encontrado')
          : `apaga ${p.trechos ?? 0} trecho(s) de ${p.sourcePath}`}
      </p>
      {p.acao === 'guardar' && p.anexo?.previa && (
        <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-[11px] text-zinc-400">{p.anexo.previa}</p>
      )}
      {guardando
        ? <p className="mt-2 text-[11px] text-sky-300">guardando… (um material grande leva alguns minutos)</p>
        : (
          <div className="mt-3 flex gap-2">
            <button disabled={ocupado} onClick={() => onDecidir(true)} className="rounded-lg bg-emerald-700 px-3 py-1.5 text-xs text-white disabled:opacity-40">
              {p.acao === 'guardar' ? 'Guardar' : 'Remover'}
            </button>
            <button disabled={ocupado} onClick={() => onDecidir(false)} className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 disabled:opacity-40">
              Rejeitar
            </button>
          </div>
        )}
    </div>
  )
}

export function PendentesNoFio({ projectId }: { projectId: string | null }) {
  const [envelopes, setEnvelopes] = useState<Pendente[]>([])
  const [rotinas, setRotinas] = useState<Rotina[]>([])
  const [memoria, setMemoria] = useState<PropostaDeMemoria[]>([])
  const [caderno, setCaderno] = useState<PropostaDeConhecimento[]>([])
  const [agindo, setAgindo] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    const q = projectId ? `?projectId=${projectId}` : ''
    try {
      const [rEnvelopes, rRotinas, rMemoria] = await Promise.all([
        fetch(`${API_URL}/hub/handoffs/pendentes${q}`, { headers: authHeaders() }),
        fetch(`${API_URL}/rotinas${q}`, { headers: authHeaders() }),
        fetch(`${API_URL}/hub/memoria/propostas${q}`, { headers: authHeaders() }),
      ])
      if (rMemoria.ok) setMemoria(await rMemoria.json())
      // O caderno é por projeto: no Geral não há o que mostrar aqui.
      if (projectId) {
        const params = new URLSearchParams({ scopeType: 'project', projectId, status: 'candidate' })
        const rCaderno = await fetch(`${V2_URL}/memory/knowledge/proposals?${params}`, { headers: authHeaders() })
        if (rCaderno.ok) setCaderno(await rCaderno.json())
      } else {
        setCaderno([])
      }
      if (rEnvelopes.ok) setEnvelopes(await rEnvelopes.json())
      if (rRotinas.ok) setRotinas(((await rRotinas.json()) as Rotina[]).filter((r) => r.status === 'proposta'))
    } catch {
      // Falha de rede não apaga um cartão já mostrado: some quando o servidor disser que acabou.
    }
  }, [projectId])

  useEffect(() => {
    void carregar()
    const t = setInterval(() => void carregar(), INTERVALO_MS)
    const aoConcluir = () => void carregar()
    window.addEventListener(EVENTO_TURNO_CONCLUIDO, aoConcluir)
    return () => { clearInterval(t); window.removeEventListener(EVENTO_TURNO_CONCLUIDO, aoConcluir) }
  }, [carregar])

  // Rotina proposta só tem uma ação: aprovar (pausar, retomar e testar valem para a ativa, no modal).
  const aprovarRotina = async (rotina: Rotina) => {
    if (!confirm(`Aprovar "${rotina.nome}"? Ela passa a disparar sozinha (${descreverGatilho(rotina.gatilho)}), e cada disparo cria um envelope para você aprovar.`)) return
    setAgindo(rotina.id)
    try {
      const r = await fetch(`${API_URL}/rotinas/${rotina.id}/aprovar`, { method: 'POST', headers: authHeaders() })
      const corpo = await r.json().catch(() => ({})) as { message?: string }
      if (!r.ok) throw new Error(corpo.message ?? 'Não foi possível aprovar a rotina.')
      toast.success('Rotina aprovada.')
      await carregar()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível aprovar a rotina.')
    } finally {
      setAgindo(null)
    }
  }

  const decidirMemoria = async (p: PropostaDeMemoria, aprovar: boolean) => {
    if (aprovar && p.acao === 'remover' && !confirm(`Remover "${p.titulo}" da memória deste projeto? Os ${p.trechos ?? 0} trecho(s) saem da busca.`)) return
    setAgindo(p.id)
    try {
      const r = await fetch(`${API_URL}/hub/memoria/propostas/${p.id}/${aprovar ? 'aprovar' : 'rejeitar'}`, { method: 'POST', headers: authHeaders() })
      const corpo = await r.json().catch(() => ({})) as { message?: string }
      if (!r.ok) throw new Error(corpo.message ?? 'Não foi possível decidir.')
      toast.success(!aprovar ? 'Proposta rejeitada — a memória não mudou.'
        : p.acao === 'guardar' ? 'Guardando na memória — o cartão some quando terminar.' : 'Removido da memória.')
      await carregar()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível decidir.')
    } finally {
      setAgindo(null)
    }
  }

  const decidirConhecimento = async (p: PropostaDeConhecimento, aprovar: boolean) => {
    const motivo = aprovar ? undefined : (window.prompt('Motivo da rejeição (opcional):') ?? undefined)
    setAgindo(p.id)
    try {
      const r = await fetch(`${V2_URL}/memory/knowledge/proposals/${p.id}/${aprovar ? 'approve' : 'reject'}`, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(motivo ? { reason: motivo } : {}),
      })
      if (!r.ok) throw new Error(r.status === 403 ? 'Só o dono do conhecimento aprova.' : 'Não foi possível decidir.')
      toast.success(aprovar ? 'Anotado no caderno.' : 'Proposta rejeitada — o caderno não mudou.')
      await carregar()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível decidir.')
    } finally {
      setAgindo(null)
    }
  }

  const total = envelopes.length + rotinas.length + memoria.length + caderno.length
  if (total === 0) return null
  return (
    <section className="hud-input-bar shrink-0 px-4 pt-3" aria-label="Aguardando sua aprovação">
      <div className="mx-auto max-w-3xl space-y-2">
        <h3 className="text-xs font-medium text-amber-300">Aguardando sua aprovação ({total})</h3>
        <div className="max-h-[45vh] space-y-2 overflow-y-auto">
          {envelopes.map((item) => <CartaoDePendente key={item.id} item={item} onDecidido={() => void carregar()} />)}
          {rotinas.map((r) => (
            <CartaoDeRotina key={r.id} rotina={r} ocupado={agindo !== null} onAcao={() => void aprovarRotina(r)} />
          ))}
          {caderno.map((p) => (
            <CartaoDeConhecimento key={p.id} p={p} ocupado={agindo !== null} onDecidir={(a) => void decidirConhecimento(p, a)} />
          ))}
          {memoria.map((p) => (
            <CartaoDeMemoria key={p.id} p={p} ocupado={agindo !== null} onDecidir={(a) => void decidirMemoria(p, a)} />
          ))}
        </div>
      </div>
    </section>
  )
}
