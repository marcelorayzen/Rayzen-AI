'use client'

/**
 * Custo e Conhecimento — os dois conjuntos de dado que a V2 acumulava sem tela.
 *
 * Em 2026-08-13 o levantamento de módulos congelados (docs/FROZEN.md) separou
 * "construído e sem uso" de "tem dado real e ninguém olha". Estes dois caíram no
 * segundo caso: 220 registros de custo e 570 nós de conhecimento sem nenhuma
 * interface. Congelar apagaria dado útil da vista; a solução era a oposta.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { API_URL, V2_URL } from '../../lib/api-url'
import { authHeaders } from '../../lib/api-client'

// ── tipos das rotas V2 ────────────────────────────────────────────────────────

interface Breakdown {
  projectId:   string
  totalUsd:    number
  byModel:     Record<string, number>
  byMission:   Record<string, number>
  byModule:    Record<string, number>
  recordCount: number
}

interface KnowledgeNode {
  id:        string
  type:      string
  label:     string
  updatedAt?: string
}

interface KnowledgeEdge {
  fromNodeId: string
  toNodeId:   string
  relation:   string
}

interface KnowledgeGraph {
  nodes:     KnowledgeNode[]
  edges:     KnowledgeEdge[]
  nodeCount: number
  edgeCount: number
}

interface Project { id: string; name: string; status: string }

interface StatusComponente {
  id:            string
  titulo:        string
  onde:          string
  estado:        'nunca-subiu' | 'saudavel' | 'falhando' | 'sem-noticia'
  lastAttemptAt: string | null
  lastSuccessAt: string | null
  atrasoMs:      number | null
  lastError:     string | null
  host:          string | null
  desligarCom:   string | null
}

const ESTADO_COR: Record<string, string> = {
  'saudavel':    '#22c55e',
  'falhando':    '#ef4444',
  'sem-noticia': '#f59e0b',
  'nunca-subiu': '#71717a',
}

const ESTADO_TEXTO: Record<string, string> = {
  'saudavel':    'saudável',
  'falhando':    'roda e falha',
  'sem-noticia': 'sem notícia',
  'nunca-subiu': 'nunca subiu',
}

/** "há 3 min" — o dado que responde a pergunta do painel. */
function desde(iso: string | null): string {
  if (!iso) return '—'
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (min < 1)    return 'agora'
  if (min < 60)   return `há ${min} min`
  const h = Math.round(min / 60)
  return h < 48 ? `há ${h}h` : `há ${Math.round(h / 24)}d`
}

// ── helpers ───────────────────────────────────────────────────────────────────

/**
 * Custos aqui são centavos de dólar. `toFixed(2)` mostraria "$0.00" para tudo e
 * um painel que sempre diz zero é indistinguível de um painel quebrado — que foi
 * literalmente o estado anterior.
 */
function usd(v: number): string {
  if (v === 0)      return '$0'
  if (v < 0.01)     return `$${v.toFixed(5)}`
  if (v < 1)        return `$${v.toFixed(4)}`
  return `$${v.toFixed(2)}`
}

const TYPE_LABEL: Record<string, string> = {
  file: 'arquivo', module: 'módulo', entity: 'entidade',
  concept: 'conceito', rule: 'regra', adr: 'ADR',
}

function Bars({ data, empty }: { data: Record<string, number>; empty: string }) {
  const rows = Object.entries(data).sort((a, b) => b[1] - a[1])
  if (rows.length === 0) return <p className="text-sm text-zinc-500 italic">{empty}</p>
  const max = rows[0][1] || 1
  return (
    <div className="space-y-1.5">
      {rows.map(([k, v]) => (
        <div key={k} className="flex items-center gap-2 text-sm">
          <span className="w-52 shrink-0 truncate font-mono text-xs text-zinc-300" title={k}>{k}</span>
          <div className="flex-1 h-4 bg-zinc-800/60 rounded overflow-hidden">
            <div className="h-full bg-emerald-500/60" style={{ width: `${Math.max(2, (v / max) * 100)}%` }} />
          </div>
          <span className="w-24 shrink-0 text-right font-mono text-xs text-zinc-400">{usd(v)}</span>
        </div>
      ))}
    </div>
  )
}

// ── página ────────────────────────────────────────────────────────────────────

export default function InsightsPage() {
  const [tab,       setTab]       = useState<'custo' | 'conhecimento' | 'sistemas'>('custo')
  const [projects,  setProjects]  = useState<Project[]>([])
  const [projectId, setProjectId] = useState('')
  const [days,      setDays]      = useState(30)
  const [cost,      setCost]      = useState<Breakdown | null>(null)
  const [graph,     setGraph]     = useState<KnowledgeGraph | null>(null)
  const [sistemas,  setSistemas]  = useState<StatusComponente[] | null>(null)
  const [loading,   setLoading]   = useState(false)
  const [erro,      setErro]      = useState('')

  useEffect(() => {
    // Projetos vivem na V1 — a V2 não tem rota `/projects`.
    fetch(`${API_URL}/projects`, { headers: authHeaders() })
      .then((r) => (r.ok ? r.json() : []))
      .then((all: Project[]) => {
        const list = all.filter((p) => p.status === 'active')
        setProjects(list)

        // Sem default silencioso para um projeto FIXO: atribuir custo ao projeto errado
        // já aconteceu neste sistema e é corrupção que ninguém percebe.
        //
        // Restaurar o projeto que o usuário escolheu no header é outra coisa — é a
        // escolha explícita dele, não um chute do código, e é o que `/guardian` e
        // `/work-panel` já fazem. Só entra se o projeto ainda existir e estiver ativo;
        // não há fallback para `list[0]`, que seria justamente o default arbitrário.
        const escolhido = typeof window !== 'undefined'
          ? localStorage.getItem('rayzen_active_project_id')
          : null
        if (escolhido && list.some((p) => p.id === escolhido)) setProjectId(escolhido)
        else if (list.length === 1) setProjectId(list[0].id)
      })
      .catch(() => setProjects([]))
  }, [])

  const carregar = useCallback(async () => {
    if (!projectId) return
    setLoading(true); setErro('')
    try {
      const [c, g] = await Promise.all([
        fetch(`${V2_URL}/costs/${projectId}/breakdown?days=${days}`, { headers: authHeaders() }),
        fetch(`${V2_URL}/knowledge/graph/${projectId}`,               { headers: authHeaders() }),
      ])
      setCost(c.ok  ? await c.json() : null)
      setGraph(g.ok ? await g.json() : null)
      if (!c.ok && !g.ok) setErro('As duas rotas responderam erro — a API V2 está de pé?')
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [projectId, days])

  useEffect(() => { void carregar() }, [carregar])

  // Independe de projeto selecionado: ciclo do sistema não é por projeto.
  useEffect(() => {
    fetch(`${V2_URL}/system/status`, { headers: authHeaders() })
      .then((r) => (r.ok ? r.json() : null))
      .then(setSistemas)
      .catch(() => setSistemas(null))
  }, [])

  // Camada semântica vs. varredura de arquivos. 537 dos 570 nós são `file` vindos
  // do graphify; listar tudo junto esconde os 33 nós que alguém escreveu à mão.
  const semanticos = useMemo(
    () => (graph?.nodes ?? []).filter((n) => n.type !== 'file'),
    [graph],
  )

  const porTipo = useMemo(() => {
    const acc: Record<string, number> = {}
    for (const n of graph?.nodes ?? []) acc[n.type] = (acc[n.type] ?? 0) + 1
    return Object.entries(acc).sort((a, b) => b[1] - a[1])
  }, [graph])

  /** Arquivos dos quais mais coisas dependem — o raio de impacto de mexer neles. */
  const hubs = useMemo(() => {
    if (!graph) return []
    const label = new Map(graph.nodes.map((n) => [n.id, n.label]))
    const inDeg: Record<string, number> = {}
    for (const e of graph.edges) {
      if (e.relation !== 'depende_de') continue
      inDeg[e.toNodeId] = (inDeg[e.toNodeId] ?? 0) + 1
    }
    return Object.entries(inDeg)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(([id, n]) => ({ label: label.get(id) ?? id, n }))
  }, [graph])

  const semDado = cost !== null && cost.recordCount === 0

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100 p-6">
      <div className="max-w-5xl mx-auto space-y-5">

        <header className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold">Custo e Conhecimento</h1>
            <p className="text-sm text-zinc-500">Os dados que a V2 acumulava sem nenhuma tela.</p>
          </div>
          <Link href="/" className="hud-nav text-sm">← início</Link>
        </header>

        <div className="flex items-center gap-2 flex-wrap">
          <select
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            className="bg-zinc-900 border border-zinc-700 rounded px-3 py-1.5 text-sm"
          >
            <option value="">selecione um projeto…</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>

          {tab === 'custo' && (
            <select
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
              className="bg-zinc-900 border border-zinc-700 rounded px-3 py-1.5 text-sm"
            >
              <option value={1}>24h</option>
              <option value={7}>7 dias</option>
              <option value={30}>30 dias</option>
              <option value={365}>1 ano</option>
            </select>
          )}

          <button onClick={() => void carregar()} disabled={!projectId || loading}
                  className="hud-nav text-sm disabled:opacity-40">
            {loading ? 'carregando…' : 'atualizar'}
          </button>

          <div className="ml-auto flex gap-1">
            {(['custo', 'conhecimento', 'sistemas'] as const).map((t) => (
              <button key={t} onClick={() => setTab(t)}
                      className={`px-3 py-1.5 rounded text-sm ${tab === t ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'}`}>
                {t}
              </button>
            ))}
          </div>
        </div>

        {erro && <p className="text-sm text-red-400 border border-red-900/50 bg-red-950/30 rounded px-3 py-2">{erro}</p>}
        {!projectId && tab !== 'sistemas' && <p className="text-sm text-zinc-500">Escolha um projeto para ver os números.</p>}

        {/* ── custo ─────────────────────────────────────────────────────────── */}
        {tab === 'custo' && projectId && cost && (
          <section className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <div className="border border-zinc-800 rounded p-3">
                <div className="text-xs text-zinc-500">gasto no período</div>
                <div className="text-2xl font-mono">{usd(cost.totalUsd)}</div>
              </div>
              <div className="border border-zinc-800 rounded p-3">
                <div className="text-xs text-zinc-500">chamadas registradas</div>
                <div className="text-2xl font-mono">{cost.recordCount}</div>
              </div>
              <div className="border border-zinc-800 rounded p-3">
                <div className="text-xs text-zinc-500">custo médio por chamada</div>
                <div className="text-2xl font-mono">
                  {cost.recordCount ? usd(cost.totalUsd / cost.recordCount) : '—'}
                </div>
              </div>
            </div>

            {semDado && (
              // Distinguir "não gastou" de "não mediu" — até 2026-08-14 nada gravava
              // custo, e um zero mudo aqui seria lido como economia.
              <p className="text-sm text-amber-400/90 border border-amber-900/40 bg-amber-950/20 rounded px-3 py-2">
                Nenhum registro no período. Custo só passa a ser gravado nas chamadas feitas
                depois de 14/08/2026 — antes disso, apenas o executor de missões registrava,
                e ele está congelado desde junho.
              </p>
            )}

            <div>
              <h2 className="text-sm font-semibold text-zinc-400 mb-2">por módulo — quem gastou</h2>
              <Bars data={cost.byModule ?? {}} empty="sem gasto atribuído a módulo no período." />
            </div>

            <div>
              <h2 className="text-sm font-semibold text-zinc-400 mb-2">por modelo — o que respondeu</h2>
              <Bars data={cost.byModel} empty="sem gasto no período." />
            </div>

            {Object.keys(cost.byMission).length > 0 && (
              <div>
                <h2 className="text-sm font-semibold text-zinc-400 mb-2">por missão</h2>
                <Bars data={cost.byMission} empty="" />
              </div>
            )}
          </section>
        )}

        {/* ── sistemas ──────────────────────────────────────────────────────── */}
        {tab === 'sistemas' && (
          <section className="space-y-4">
            <p className="text-xs text-zinc-500 leading-relaxed border-l-2 border-zinc-800 pl-3">
              Os ciclos que rodam sozinhos. O painel mede <strong>última notícia</strong>, não
              &ldquo;vivo&rdquo;: o Guardian roda no agent desktop e reporta por HTTP, então silêncio aqui
              pode ser processo parado ou máquina sem alcançar a API — nos dois casos o valor
              entregue é zero. Componente que nunca bateu aparece como <em>nunca subiu</em>, e é
              por isso que a lista vem de um catálogo declarado em vez de quem apareceu.
            </p>

            {sistemas === null
              ? <p className="text-sm text-zinc-500 italic">Não foi possível ler o status — a API V2 está de pé?</p>
              : (
                <div className="space-y-2">
                  {sistemas.map((c) => (
                    <div key={c.id} className="border border-zinc-800 rounded p-3 flex items-start gap-3">
                      <span
                        className="mt-1.5 w-2 h-2 rounded-full shrink-0"
                        style={{ background: ESTADO_COR[c.estado] }}
                        title={ESTADO_TEXTO[c.estado]}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono text-sm">{c.id}</span>
                          <span className="text-xs px-1.5 py-0.5 rounded bg-zinc-800/70 text-zinc-400">{c.onde}</span>
                          <span className="text-xs" style={{ color: ESTADO_COR[c.estado] }}>
                            {ESTADO_TEXTO[c.estado]}
                          </span>
                        </div>
                        <div className="text-xs text-zinc-500 mt-0.5 truncate" title={c.titulo}>{c.titulo}</div>

                        <div className="text-xs text-zinc-400 mt-1.5 flex gap-4 flex-wrap">
                          <span>tentativa: <span className="font-mono">{desde(c.lastAttemptAt)}</span></span>
                          <span>sucesso: <span className="font-mono">{desde(c.lastSuccessAt)}</span></span>
                          {c.host && <span className="text-zinc-500">{c.host}</span>}
                        </div>

                        {c.lastError && (
                          <div className="text-xs text-red-400/90 mt-1 truncate" title={c.lastError}>
                            {c.lastError}
                          </div>
                        )}
                        {c.estado === 'nunca-subiu' && c.desligarCom && (
                          <div className="text-xs text-zinc-500 mt-1">
                            desligado por <code className="text-zinc-400">{c.desligarCom}</code>?
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
          </section>
        )}

        {/* ── conhecimento ──────────────────────────────────────────────────── */}
        {tab === 'conhecimento' && projectId && graph && (
          <section className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <div className="border border-zinc-800 rounded p-3">
                <div className="text-xs text-zinc-500">nós</div>
                <div className="text-2xl font-mono">{graph.nodeCount}</div>
              </div>
              <div className="border border-zinc-800 rounded p-3">
                <div className="text-xs text-zinc-500">arestas</div>
                <div className="text-2xl font-mono">{graph.edgeCount}</div>
              </div>
              <div className="border border-zinc-800 rounded p-3">
                <div className="text-xs text-zinc-500">camada semântica</div>
                <div className="text-2xl font-mono">{semanticos.length}</div>
              </div>
            </div>

            <p className="text-xs text-zinc-500 leading-relaxed border-l-2 border-zinc-800 pl-3">
              A maior parte dos nós é varredura de arquivos com aresta <code>depende_de</code> — mesma
              informação que o <code>graphify query</code> responde no terminal. O que existe só aqui é
              a camada semântica abaixo: módulos, entidades, conceitos, regras e ADRs escritos à mão.
            </p>

            <div>
              <h2 className="text-sm font-semibold text-zinc-400 mb-2">composição</h2>
              <div className="flex gap-2 flex-wrap">
                {porTipo.map(([t, n]) => (
                  <span key={t} className="text-xs px-2 py-1 rounded bg-zinc-800/70 font-mono">
                    {TYPE_LABEL[t] ?? t}: {n}
                  </span>
                ))}
              </div>
            </div>

            <div>
              <h2 className="text-sm font-semibold text-zinc-400 mb-2">
                camada semântica ({semanticos.length})
              </h2>
              {semanticos.length === 0
                ? <p className="text-sm text-zinc-500 italic">Nenhum nó além da varredura de arquivos.</p>
                : (
                  <div className="grid sm:grid-cols-2 gap-1.5">
                    {semanticos.map((n) => (
                      <div key={n.id} className="flex items-center gap-2 text-sm border border-zinc-800/70 rounded px-2 py-1.5">
                        <span className="text-[10px] uppercase text-zinc-500 w-16 shrink-0">{TYPE_LABEL[n.type] ?? n.type}</span>
                        <span className="truncate" title={n.label}>{n.label}</span>
                      </div>
                    ))}
                  </div>
                )}
            </div>

            <div>
              <h2 className="text-sm font-semibold text-zinc-400 mb-2">
                mais dependidos — o raio de impacto de mexer neles
              </h2>
              {hubs.length === 0
                ? <p className="text-sm text-zinc-500 italic">Nenhuma aresta <code>depende_de</code> registrada.</p>
                : (
                  <div className="space-y-1">
                    {hubs.map((h) => (
                      <div key={h.label} className="flex items-center gap-2 text-sm">
                        <span className="flex-1 truncate font-mono text-xs text-zinc-300" title={h.label}>{h.label}</span>
                        <span className="text-xs text-zinc-500">{h.n} dependentes</span>
                      </div>
                    ))}
                  </div>
                )}
            </div>
          </section>
        )}
      </div>
    </main>
  )
}
