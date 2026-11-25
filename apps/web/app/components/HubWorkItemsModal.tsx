'use client'

import { useEffect, useState } from 'react'
import { API_URL } from '../../lib/api-url'
import { authHeaders } from '../../lib/api-client'
import { toast } from './toast'
import { HubRotinas } from './HubRotinas'

/** Projeção pública da entrega confirmada (item 7.2a) — o servidor já saneou o link do PR. */
type Entrega = {
  branch: string
  commit: string
  publicado: boolean
  prUrl: string | null
  prEstado: string | null
  prRascunho: boolean | null
  medidoEm: string | null
}
type MetricasDaSessao = {
  papel: string | null
  provedor: string | null
  modelo: string | null
  costUsd: number | null
  numTurns: number | null
}
type Handoff = { id: string; name: string; status: string; createdAt: string; entrega?: Entrega | null }

const ESTADO_DO_PR: Record<string, string> = { OPEN: 'aberto', MERGED: 'mesclado', CLOSED: 'fechado' }
const ROTULOS_DE_PAPEL: Record<string, string> = { developer: 'Developer' }
const ROTULOS_DE_PROVEDOR: Record<string, string> = { 'claude-code': 'Claude Code' }

function linhaDeMetricas(sessao: MetricasDaSessao) {
  const autoria = [
    sessao.papel ? ROTULOS_DE_PAPEL[sessao.papel] ?? sessao.papel : null,
    sessao.provedor ? ROTULOS_DE_PROVEDOR[sessao.provedor] ?? sessao.provedor : null,
    sessao.modelo,
  ].filter((valor): valor is string => Boolean(valor))
  const custo = sessao.costUsd === null
    ? 'custo sem registro'
    : `US$ ${new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(sessao.costUsd)} (estimativa da CLI)`
  const turnos = sessao.numTurns === null ? null : `${sessao.numTurns} turnos`
  return [...autoria, custo, turnos].filter((valor): valor is string => Boolean(valor)).join(' · ')
}

/** G2.10: quem aprovou, em palavras. `hub:<hash>` é uma pessoa logada no Hub. */
function rotuloDeQuemAprovou(aprovadoPor: string): string {
  if (aprovadoPor.startsWith('hub:')) return 'você, pelo Hub'
  if (aprovadoPor === 'alcada:autonomo') return 'alçada autônoma (sem toque)'
  return aprovadoPor
}

const ROTULO_DA_VERIFICACAO: Record<string, string> = {
  passou: 'passou',
  falhou: 'FALHOU',
  timeout: 'não terminou em 10 min',
  'não verificado': 'não verificado (o projeto não tem script de teste)',
}
const COR_DA_VERIFICACAO: Record<string, string> = { passou: 'text-emerald-300', 'não verificado': 'text-zinc-400' }

function CartaoDeEntrega({ entrega, sessao, extra, abrindo, onAbrir }: {
  entrega: Entrega
  sessao: MetricasDaSessao | null
  extra?: ExtraDaEntrega
  abrindo: boolean
  /** Só para entrega vinculada ao fio: a rota de abrir usa o id do vínculo, não o do envelope. */
  onAbrir?: () => void
}) {
  const estado = entrega.prEstado ? (ESTADO_DO_PR[entrega.prEstado] ?? entrega.prEstado.toLowerCase()) : null
  return (
    <div className="mt-3 rounded-lg border border-emerald-900/60 bg-emerald-950/20 p-3">
      <p className="text-[11px] font-medium uppercase tracking-wide text-emerald-400">Entrega confirmada</p>
      <p className="mt-1 break-all font-mono text-xs text-zinc-300">{entrega.branch}</p>
      <p className="mt-0.5 text-[11px] text-zinc-500">
        commit {entrega.commit.slice(0, 8)}
        {entrega.publicado ? '' : ' · só nesta máquina'}
        {estado ? ` · PR ${estado}${entrega.prRascunho ? ' (rascunho)' : ''}` : ''}
        {entrega.medidoEm ? ` · verificado ${new Date(entrega.medidoEm).toLocaleString('pt-BR')}` : ''}
      </p>
      {sessao && <p className="mt-1 text-[11px] text-zinc-400">{linhaDeMetricas(sessao)}</p>}
      {extra?.verificacao && (
        <p className={`mt-1 text-[11px] ${COR_DA_VERIFICACAO[extra.verificacao.status] ?? 'text-rose-300'}`}>
          Testes rodados pelo Rayzen: {ROTULO_DA_VERIFICACAO[extra.verificacao.status] ?? extra.verificacao.status}
          {extra.verificacao.comando ? <> · <span className="font-mono">{extra.verificacao.comando}</span></> : null}
        </p>
      )}
      {extra?.aprovadoPor && <p className="mt-1 text-[11px] text-zinc-400">Aprovado por {rotuloDeQuemAprovou(extra.aprovadoPor)}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        {entrega.prUrl && (
          <a
            href={entrega.prUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg bg-emerald-700 px-3 py-1.5 text-xs text-white"
          >
            Ver PR
          </a>
        )}
        {onAbrir && (
          <button
            disabled={abrindo}
            onClick={onAbrir}
            className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-200 disabled:opacity-40"
          >
            {abrindo ? 'abrindo…' : 'Abrir na minha máquina'}
          </button>
        )}
      </div>
      {entrega.publicado && !entrega.prUrl && (
        <p className="mt-2 text-[11px] text-amber-400">Branch publicada, mas o PR não foi encontrado — revise pelo GitHub.</p>
      )}
    </div>
  )
}
type LinkedHandoff = {
  id: string
  sourceId: string
  linkedAt: string
  handoff: Handoff | null
}

/** Envelope aguardando aprovação — o servidor manda o conteúdo inteiro: aprova-se o que se vê. */
export type Pendente = {
  id: string
  name: string
  brief: string
  root: string
  version: number
  contentHash: string
  createdAt: string
  createdBy: string
  efeitos: { actionKey: string; payload: Record<string, unknown> }[]
  /** Do servidor (S1): só `critico` pede o código. Ausente = servidor antigo, tratado como crítico. */
  alcada?: 'autonomo' | 'propoe' | 'critico'
  /** Do servidor (S1f): o que muda a decisão, medido na prévia do envio. */
  avisos?: string[]
}

/** Linha do resumo do S1 — vem do registro de envelopes, não da redação do modelo. */
/** `retomavel` (G3.2): envelope incerto cuja sessão o executor largou no meio. */
type LinhaDoResumo = { id: string; name: string; status: string; motivo: string | null; quando: string; acao: string | null; retomavel?: boolean }
type Resumo = {
  janelaDias: number
  fizSozinho: LinhaDoResumo[]
  proponho: LinhaDoResumo[]
  precisaDeVoce: LinhaDoResumo[]
  entregas?: ({ handoffId: string; name: string; entrega: Entrega; sessao: MetricasDaSessao | null } & ExtraDaEntrega)[]
  emAndamento?: EmAndamento[]
}

type ExtraDaEntrega = {
  aprovadoPor?: string | null
  verificacao?: { status: string; comando: string } | null
}

/** G2.9: envelope que o executor está rodando agora, com a sessão dele. */
type EmAndamento = {
  id: string
  name: string
  status: string
  quando: string
  sessao: { id: string; status: string | null; etapa: string | null; aguardandoResposta: boolean; vscodeUrl: string | null } | null
}

const ROTULO_DO_ANDAMENTO: Record<string, string> = {
  queued: 'na fila', claimed: 'começando', executing: 'trabalhando', reconciling: 'conferindo o resultado',
}

/**
 * G2.9 (24/11): o cartão do que está rodando. Antes o envelope sumia do "trabalhos" justo
 * enquanto trabalhava; o Parar e o log ao vivo só existiam no `/work-panel` antigo.
 */
function CartaoEmAndamento({ item, parando, onParar }: { item: EmAndamento; parando: boolean; onParar: () => void }) {
  const s = item.sessao
  const podeParar = s?.status === 'active'
  return (
    <div className="rounded-xl border border-sky-900/60 bg-sky-950/20 p-3">
      <p className="text-sm text-zinc-200">{item.name}</p>
      <p className="mt-0.5 text-[11px] text-zinc-500">
        {ROTULO_DO_ANDAMENTO[item.status] ?? item.status}
        {s?.status === 'stopping' ? ' · parando…' : ''}
        {s?.aguardandoResposta ? ' · esperando você no fio' : ''}
      </p>
      {s?.etapa && <p className="mt-1 break-words font-mono text-[11px] text-zinc-300">{s.etapa}</p>}
      {s && (podeParar || s.vscodeUrl) && (
        <div className="mt-2 flex flex-wrap gap-2">
          {podeParar && (
            <button disabled={parando} onClick={onParar} className="rounded-lg bg-rose-800 px-3 py-1.5 text-xs text-white disabled:opacity-40">
              {parando ? 'parando…' : 'Parar'}
            </button>
          )}
          {s.vscodeUrl && (
            <a href={s.vscodeUrl} className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-200">
              Assumir no VS Code
            </a>
          )}
        </div>
      )}
      {s?.vscodeUrl && <p className="mt-2 text-[10px] text-zinc-500">O VS Code abre no PC, pela extensão Remote-SSH, na pasta desta sessão no servidor.</p>}
    </div>
  )
}

function CartaoParado({ item, ocupado, onRetomar, onDescartar }: {
  item: LinhaDoResumo; ocupado: boolean; onRetomar: () => void; onDescartar: () => void
}) {
  const incerto = item.status === 'effect_unknown'
  return (
    <div className="rounded-xl border border-rose-900/60 bg-rose-950/20 p-3">
      <p className="text-sm text-zinc-200">{item.name}</p>
      <p className="mt-0.5 text-[11px] text-zinc-500">
        {incerto ? 'efeito incerto' : 'aprovado, não rodou'} · <span className="font-mono">{item.acao}</span> · {new Date(item.quando).toLocaleString('pt-BR')}
      </p>
      {item.motivo && <p className="mt-1 text-[11px] text-zinc-400">{item.motivo}</p>}
      <div className="mt-2 flex flex-wrap gap-2">
        {(!incerto || item.retomavel) && (
          <button disabled={ocupado} onClick={onRetomar} className="rounded-lg bg-sky-700 px-3 py-1.5 text-xs text-white disabled:opacity-40">
            {incerto ? 'Retomar de onde parou' : 'Retomar'}
          </button>
        )}
        <button disabled={ocupado} onClick={onDescartar} className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 disabled:opacity-40">
          Descartar
        </button>
      </div>
      {incerto && item.retomavel && (
        <p className="mt-2 text-[10px] text-sky-300">A sessão foi interrompida no meio. Retomar continua na mesma pasta, sem refazer o que já foi salvo, e para no diff para você decidir.</p>
      )}
      {incerto && !item.retomavel && (
        <p className="mt-2 text-[10px] text-amber-400">Não se sabe se o efeito aconteceu. Confira o resultado antes de descartar.</p>
      )}
    </div>
  )
}

function ConteudoDoEfeito({ efeito }: { efeito: Pendente['efeitos'][number] }) {
  const p = efeito.payload
  const arquivos = Array.isArray(p.arquivos) ? (p.arquivos as { path: string; conteudo: string }[]) : []
  return (
    <div className="mt-2 space-y-1 text-[11px] text-zinc-400">
      <p><span className="text-zinc-500">efeito:</span> <span className="font-mono">{efeito.actionKey}</span></p>
      {typeof p.template === 'string' && <p><span className="text-zinc-500">template:</span> {p.template}</p>}
      {typeof p.prompt === 'string' && (
        <p className="whitespace-pre-wrap"><span className="text-zinc-500">pedido:</span> {p.prompt}</p>
      )}
      {typeof p.aprovacao === 'string' && (
        <p><span className="text-zinc-500">acompanhamento:</span> {p.aprovacao === 'por_etapa' ? 'para em cada etapa' : 'para só no diff final'}</p>
      )}
      {typeof p.baseRef === 'string' && (
        <p><span className="text-zinc-500">parte do ramo:</span> <span className="font-mono">{p.baseRef}</span> (o PR vai contra ele)</p>
      )}
      {p.publicar === true && <p className="text-amber-400">ao concluir, publica um PR em rascunho (depois de você ver o diff)</p>}
      {arquivos.length > 0 && (
        <div>
          <p className="text-zinc-500">{arquivos.length} arquivo(s) — gravados exatamente assim:</p>
          {arquivos.map((a) => (
            <details key={a.path} className="ml-2">
              <summary className="cursor-pointer font-mono text-zinc-300">{a.path}</summary>
              <pre className="mt-1 max-h-60 overflow-auto whitespace-pre-wrap rounded bg-zinc-950 p-2 text-[10px] text-zinc-400">{a.conteudo}</pre>
            </details>
          ))}
        </div>
      )}
    </div>
  )
}

export function CartaoDePendente({ item, onDecidido }: { item: Pendente; onDecidido: () => void }) {
  const [codigo, setCodigo] = useState('')
  const [enviando, setEnviando] = useState(false)
  const pedeCodigo = item.alcada !== 'propoe' && item.alcada !== 'autonomo'

  const aprovar = async () => {
    setEnviando(true)
    try {
      const r = await fetch(`${API_URL}/hub/handoffs/${item.id}/aprovar`, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        // O hash vai junto: se o envelope mudou desde que esta tela abriu, o servidor recusa.
        body: JSON.stringify({ codigo, contentHash: item.contentHash }),
      })
      const corpo = await r.json().catch(() => ({})) as { message?: string; materializado?: boolean; motivo?: string }
      if (!r.ok) throw new Error(corpo.message ?? 'Não foi possível aprovar.')
      if (corpo.materializado) toast.success('Aprovado. A execução começou — acompanhe pelo fio.')
      else toast.error(`Aprovado, mas não começou: ${corpo.motivo ?? 'motivo desconhecido'}`)
      onDecidido()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível aprovar.')
    } finally {
      setEnviando(false)
      setCodigo('')
    }
  }

  const rejeitar = async () => {
    if (!confirm(`Rejeitar "${item.name}"? Nada será executado.`)) return
    setEnviando(true)
    try {
      const r = await fetch(`${API_URL}/hub/handoffs/${item.id}/rejeitar`, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ motivo: 'rejeitado no Hub' }),
      })
      if (!r.ok) throw new Error('Não foi possível rejeitar.')
      toast.success('Envelope rejeitado.')
      onDecidido()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível rejeitar.')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div className="rounded-xl border border-amber-900/60 bg-amber-950/20 p-3">
      <p className="text-sm text-zinc-200">{item.name}</p>
      <p className="mt-0.5 text-[11px] text-zinc-500">
        v{item.version} · por {item.createdBy} · {new Date(item.createdAt).toLocaleString('pt-BR')} · hash {item.contentHash.slice(0, 12)}
      </p>
      <p className="mt-2 whitespace-pre-wrap text-xs text-zinc-300">{item.brief}</p>
      {item.efeitos.map((e, i) => <ConteudoDoEfeito key={i} efeito={e} />)}
      {item.avisos && item.avisos.length > 0 && (
        <ul className="mt-2 space-y-1 rounded-lg border border-amber-800/60 bg-amber-950/40 p-2">
          {item.avisos.map((a) => <li key={a} className="text-[11px] text-amber-300">⚠ {a}</li>)}
        </ul>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {pedeCodigo && <input
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          placeholder="código"
          value={codigo}
          onChange={(e) => setCodigo(e.target.value.replace(/\D/g, ''))}
          className="w-24 rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-center font-mono text-sm tracking-widest text-zinc-100"
        />}
        <button
          disabled={enviando || (pedeCodigo && codigo.length !== 6)}
          onClick={() => void aprovar()}
          className="rounded-lg bg-emerald-700 px-3 py-1.5 text-xs text-white disabled:opacity-40"
        >
          {enviando ? 'enviando…' : 'Aprovar'}
        </button>
        <button
          disabled={enviando}
          onClick={() => void rejeitar()}
          className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 disabled:opacity-40"
        >
          Rejeitar
        </button>
      </div>
      <p className="mt-2 text-[10px] text-zinc-500">
        {pedeCodigo
          ? 'Efeito crítico: o código do autenticador prova que é você — o agent não tem como gerá-lo.'
          : 'Um toque basta: só uma pessoa logada aprova, o agent não alcança este botão.'}
      </p>
    </div>
  )
}

/**
 * `projectId` nulo = contexto Geral: sem fio de projeto, só a seção de aprovação, com os
 * pendentes de TODOS os projetos — é no Geral que o Hub propõe projeto novo.
 */
export function HubWorkItemsModal({ projectId, onClose }: { projectId: string | null; onClose: () => void }) {
  const [candidates, setCandidates] = useState<Handoff[]>([])
  const [linked, setLinked] = useState<LinkedHandoff[]>([])
  const [pendentes, setPendentes] = useState<Pendente[]>([])
  const [resumo, setResumo] = useState<Resumo | null>(null)
  const [loading, setLoading] = useState(true)
  const [acting, setActing] = useState<string | null>(null)

  /** O resumo é complementar: falhar não esconde o painel, mas também não finge que não há nada. */
  const carregarResumo = async (silencioso = false) => {
    try {
      const q = projectId ? `?projectId=${projectId}` : ''
      const r = await fetch(`${API_URL}/hub/handoffs/resumo${q}`, { headers: authHeaders() })
      if (!r.ok) throw new Error('resumo')
      setResumo(await r.json())
    } catch {
      // A atualização ao vivo falhar uma vez não apaga o que já está na tela nem enche de avisos.
      if (silencioso) return
      setResumo(null)
      toast.error('Não foi possível carregar o que foi feito sozinho e o que está parado.')
    }
  }

  const load = async () => {
    setLoading(true)
    void carregarResumo()
    if (!projectId) {
      try {
        const r = await fetch(`${API_URL}/hub/handoffs/pendentes`, { headers: authHeaders() })
        if (!r.ok) throw new Error('pendentes')
        setPendentes(await r.json())
      } catch {
        toast.error('Não foi possível carregar os envelopes aguardando aprovação.')
      } finally {
        setLoading(false)
      }
      return
    }
    try {
      const [candidatesResponse, linkedResponse, pendentesResponse] = await Promise.all([
        fetch(`${API_URL}/hub/work-items/reconcile/handoffs?projectId=${projectId}`, { headers: authHeaders() }),
        fetch(`${API_URL}/hub/work-items/linked/handoffs?projectId=${projectId}`, { headers: authHeaders() }),
        fetch(`${API_URL}/hub/handoffs/pendentes?projectId=${projectId}`, { headers: authHeaders() }),
      ])
      if (!candidatesResponse.ok || !linkedResponse.ok) throw new Error('hub_work_items_load_failed')
      setCandidates(await candidatesResponse.json())
      setLinked(await linkedResponse.json())
      // Pendentes falhar não esconde o resto do painel — mas também não finge lista vazia.
      setPendentes(pendentesResponse.ok ? await pendentesResponse.json() : [])
      if (!pendentesResponse.ok) toast.error('Não foi possível carregar os envelopes aguardando aprovação.')
    } catch {
      toast.error('Não foi possível carregar os trabalhos deste fio.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [projectId])

  // G2.9: com algo rodando, o resumo se atualiza sozinho a cada 5 s (etapa e estado ao vivo).
  const temAndamento = (resumo?.emAndamento?.length ?? 0) > 0
  useEffect(() => {
    if (!temAndamento) return
    const t = setInterval(() => void carregarResumo(true), 5000)
    return () => clearInterval(t)
  }, [temAndamento, projectId])

  /** Parar é pedido de pessoa: a rota recusa o token do agent. A sessão para em até ~5 s. */
  const parar = async (item: EmAndamento) => {
    if (!item.sessao) return
    if (!confirm(`Parar "${item.name}" agora? O que já foi feito fica na pasta da sessão, e nada é publicado.`)) return
    setActing(item.id)
    try {
      const r = await fetch(`${API_URL}/agent/session/${item.sessao.id}/stop`, { method: 'POST', headers: authHeaders() })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      toast.success('Pedido de parada enviado.')
      await carregarResumo(true)
    } catch (e) {
      toast.error(e instanceof Error ? `Não foi possível parar: ${e.message}` : 'Não foi possível parar.')
    } finally {
      setActing(null)
    }
  }

  const link = async (item: Handoff) => {
    if (!confirm(`Vincular "${item.name}" a este fio? Isso não executa nem altera o handoff.`)) return
    setActing(item.id)
    try {
      const response = await fetch(`${API_URL}/hub/work-items?projectId=${projectId}`, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ kind: 'project_handoff', sourceSystem: 'v1', sourceId: item.id }),
      })
      if (!response.ok) throw new Error('hub_work_item_link_failed')
      await load()
      toast.success('Trabalho vinculado ao fio.')
    } catch {
      toast.error('Não foi possível vincular o trabalho.')
    } finally {
      setActing(null)
    }
  }

  const retomar = async (item: LinhaDoResumo) => {
    if (item.status === 'effect_unknown') return retomarSessao(item)
    setActing(item.id)
    try {
      const r = await fetch(`${API_URL}/hub/handoffs/${item.id}/retomar`, { method: 'POST', headers: authHeaders() })
      const corpo = await r.json().catch(() => ({})) as { materializado?: boolean; motivo?: string; message?: string }
      if (!r.ok) throw new Error(corpo.message ?? 'Não foi possível retomar.')
      if (corpo.materializado) toast.success('Retomado. A execução começou.')
      else toast.error(`Não começou: ${corpo.motivo ?? 'motivo desconhecido'}`)
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível retomar.')
    } finally {
      setActing(null)
    }
  }

  /** G3.2: o toque aprova uma continuação na mesma pasta — por isso a confirmação diz o que roda. */
  const retomarSessao = async (item: LinhaDoResumo) => {
    if (!confirm(`Retomar "${item.name}"? A sessão continua na mesma pasta, termina o que falta e para no diff para você decidir. Nada é publicado sem você.`)) return
    setActing(item.id)
    try {
      const r = await fetch(`${API_URL}/hub/handoffs/${item.id}/retomar-sessao`, { method: 'POST', headers: authHeaders() })
      const corpo = await r.json().catch(() => ({})) as { retomado?: boolean; motivo?: string; message?: string }
      if (!r.ok) throw new Error(corpo.message ?? 'Não foi possível retomar.')
      if (corpo.retomado) toast.success('Retomado. A sessão continua de onde parou.')
      else toast.error(`Não retomou: ${corpo.motivo ?? 'motivo desconhecido'}`)
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível retomar.')
    } finally {
      setActing(null)
    }
  }

  const descartar = async (item: LinhaDoResumo) => {
    const aviso = item.status === 'effect_unknown'
      ? `Descartar "${item.name}"? Confirme antes que nada ficou pela metade — o registro dirá que você conferiu.`
      : `Descartar "${item.name}"? O aceite é cancelado e nada será executado.`
    if (!confirm(aviso)) return
    setActing(item.id)
    try {
      const r = await fetch(`${API_URL}/hub/handoffs/${item.id}/descartar`, { method: 'POST', headers: authHeaders() })
      const corpo = await r.json().catch(() => ({})) as { message?: string }
      if (!r.ok) throw new Error(corpo.message ?? 'Não foi possível descartar.')
      toast.success('Envelope descartado.')
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível descartar.')
    } finally {
      setActing(null)
    }
  }

  /** O servidor resolve o branch a partir do item; o cliente só diz qual cartão foi clicado. */
  const abrirEntrega = async (item: LinkedHandoff) => {
    setActing(item.id)
    try {
      const response = await fetch(`${API_URL}/hub/work-items/${item.id}/open-delivery?projectId=${projectId}`, {
        method: 'POST',
        headers: authHeaders(),
      })
      if (response.status === 409) throw new Error('Esta entrega ainda não foi confirmada.')
      if (!response.ok) throw new Error('O agent do PC não respondeu — ele está ligado?')
      const resultado = await response.json() as { path?: string; reutilizado?: boolean }
      toast.success(resultado.reutilizado
        ? 'Entrega reaberta no VS Code.'
        : `Entrega aberta no VS Code${resultado.path ? ` em ${resultado.path}` : ''}.`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível abrir a entrega.')
    } finally {
      setActing(null)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/70" onClick={onClose} />
      <div className="relative z-50 w-full max-w-lg max-h-[80vh] overflow-y-auto rounded-2xl border border-zinc-800 bg-zinc-900 p-6 mx-4">
        <div className="mb-4 flex justify-between">
          <div>
            <h2 className="text-sm font-semibold">{projectId ? 'Trabalhos deste fio' : 'Aprovações pendentes'}</h2>
            <p className="mt-1 text-xs text-zinc-500">
              {projectId ? 'O Hub mostra referências; o estado continua na fonte de origem.' : 'Envelopes de todos os projetos aguardando a sua decisão.'}
            </p>
          </div>
          <button onClick={onClose} className="text-xs text-zinc-500">fechar</button>
        </div>

        {loading ? <p className="text-xs text-zinc-500">Carregando…</p> : (
          <div className="space-y-5">
            {resumo?.emAndamento && resumo.emAndamento.length > 0 && (
              <section>
                <h3 className="mb-2 text-xs font-medium text-sky-300">Em andamento ({resumo.emAndamento.length})</h3>
                <div className="space-y-2">
                  {resumo.emAndamento.map((item) => (
                    <CartaoEmAndamento key={item.id} item={item} parando={acting === item.id} onParar={() => void parar(item)} />
                  ))}
                </div>
              </section>
            )}

            {pendentes.length > 0 && (
              <section>
                <h3 className="mb-2 text-xs font-medium text-amber-300">Aguardando sua aprovação ({pendentes.length})</h3>
                <div className="space-y-2">
                  {pendentes.map((item) => <CartaoDePendente key={item.id} item={item} onDecidido={() => void load()} />)}
                </div>
              </section>
            )}

            {resumo && resumo.precisaDeVoce.length > 0 && (
              <section>
                <h3 className="mb-2 text-xs font-medium text-rose-300">Parou e precisa de você ({resumo.precisaDeVoce.length})</h3>
                <div className="space-y-2">
                  {resumo.precisaDeVoce.map((item) => (
                    <CartaoParado key={item.id} item={item} ocupado={acting !== null}
                      onRetomar={() => void retomar(item)} onDescartar={() => void descartar(item)} />
                  ))}
                </div>
              </section>
            )}

            <HubRotinas projectId={projectId} onDisparou={() => void load()} />

            {resumo && (
              <section>
                <h3 className="mb-2 text-xs font-medium text-emerald-300">
                  Fiz sozinho nos últimos {resumo.janelaDias} dias ({resumo.fizSozinho.length})
                </h3>
                {resumo.fizSozinho.length === 0
                  ? <p className="text-xs text-zinc-500">Nada aprovado pela alçada autônoma neste período.</p>
                  : (
                    <ul className="space-y-1">
                      {resumo.fizSozinho.map((item) => (
                        <li key={item.id} className="text-[11px] text-zinc-400">
                          {new Date(item.quando).toLocaleString('pt-BR')} · <span className="font-mono">{item.acao}</span> · {item.name} · {item.status}
                        </li>
                      ))}
                    </ul>
                  )}
              </section>
            )}

            {/* G2.10 (24/11): a entrega aparece sem precisar de "vincular" antes — antes, o cartão
                completo só existia para o que alguém tivesse vinculado ao fio à mão. */}
            {(() => {
              const vinculados = new Set(linked.map((l) => l.handoff?.id).filter(Boolean))
              const soltas = (resumo?.entregas ?? []).filter((e) => !vinculados.has(e.handoffId))
              if (soltas.length === 0) return null
              return (
                <section>
                  <h3 className="mb-2 text-xs font-medium text-emerald-300">Entregas recentes ({soltas.length})</h3>
                  <div className="space-y-2">
                    {soltas.map((e) => (
                      <div key={e.handoffId} className="rounded-xl border border-emerald-900/40 bg-zinc-900 p-3">
                        <p className="text-sm text-zinc-200">{e.name}</p>
                        <CartaoDeEntrega
                          entrega={e.entrega}
                          sessao={e.sessao}
                          extra={e}
                          abrindo={false}
                        />
                      </div>
                    ))}
                  </div>
                </section>
              )
            })()}

            <section>
              <h3 className="mb-2 text-xs font-medium text-zinc-300">Vinculados a este fio ({linked.length})</h3>
              <div className="space-y-2">
                {linked.length === 0 && <p className="text-xs text-zinc-500">Ainda não há trabalhos vinculados.</p>}
                {linked.map((item) => item.handoff ? (
                  <div key={item.id} className="rounded-xl border border-sky-900/60 bg-sky-950/20 p-3">
                    <p className="text-sm text-zinc-200">{item.handoff.name}</p>
                    <p className="mt-1 text-[11px] text-zinc-500">origem: ProjectHandoff V1 · {item.handoff.status}</p>
                    {item.handoff.entrega && (
                      <CartaoDeEntrega
                        entrega={item.handoff.entrega}
                        sessao={resumo?.entregas?.find((e) => e.handoffId === item.handoff?.id)?.sessao ?? null}
                        extra={resumo?.entregas?.find((e) => e.handoffId === item.handoff?.id)}
                        abrindo={acting === item.id}
                        onAbrir={() => void abrirEntrega(item)}
                      />
                    )}
                  </div>
                ) : (
                  <div key={item.id} className="rounded-xl border border-amber-900/60 bg-amber-950/20 p-3">
                    <p className="text-sm text-zinc-200">Origem indisponível</p>
                    <p className="mt-1 text-[11px] text-zinc-500">Referência {item.sourceId} permanece no fio para auditoria.</p>
                  </div>
                ))}
              </div>
            </section>

            <section>
              <h3 className="mb-2 text-xs font-medium text-zinc-300">Sem vínculo ({candidates.length})</h3>
              <p className="mb-2 text-xs text-zinc-500">Escolha explicitamente o que pertence a este fio.</p>
              <div className="space-y-2">
                {candidates.length === 0 && <p className="text-xs text-zinc-500">Nenhum handoff pendente neste projeto.</p>}
                {candidates.map((item) => (
                  <div key={item.id} className="flex justify-between gap-3 rounded-xl bg-zinc-800 p-3">
                    <div>
                      <p className="text-sm text-zinc-200">{item.name}</p>
                      <p className="text-[11px] text-zinc-500">{item.status} · {new Date(item.createdAt).toLocaleString('pt-BR')}</p>
                    </div>
                    <button disabled={acting !== null} onClick={() => void link(item)} className="rounded-lg bg-sky-700 px-3 text-xs text-white disabled:opacity-40">
                      {acting === item.id ? 'vinculando…' : 'vincular'}
                    </button>
                  </div>
                ))}
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  )
}
