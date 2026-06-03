'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { API_URL, V2_URL } from '../../lib/api-url'
import { authHeaders } from '../../lib/api-client'

interface DiscoveryMsg { role: 'user' | 'assistant'; content: string }

interface Blueprint {
  projectName:   string
  segment:       string
  problem:       string
  solution:      string
  painPoints:    Array<{ description: string; severity: string }>
  personas:      Array<{ name: string; role: string; pain: string; expectation: string }>
  requirements:  Array<{ id: string; description: string; priority: string }>
  businessRules: Array<{ id: string; description: string; enforcement: string }>
  integrations:  string[]
  opportunities: Array<{ title: string; description: string; value: string; effort: string }>
  stack:         Array<{ layer: string; tech: string }>
  brief:         string
  contextSummary: string
}

interface MessageResponse { sessionId: string; reply: string; status: string; enoughInfo: boolean }

interface ProjectSpec { [k: string]: unknown }

interface CreateResult {
  path: string
  created: boolean
  projectId?: string
  repoSlug?: string
  filesGenerated?: string[]
  needsExtractionSession?: boolean
}

type CreationMode = 'new' | 'extract'

const SEV_COLOR: Record<string, string> = {
  critical: '#ef4444', high: '#f59e0b', medium: 'var(--hud-cyan)', low: 'var(--hud-dim)',
}

/** Monta o prompt de extração enviado ao Claude Code na sessão supervisionada. */
function buildExtractionPrompt(bp: Blueprint, sourceRepo: string): string {
  const stack = bp.stack.map(s => `${s.layer}: ${s.tech}`).join(', ')
  const modules = ['core', 'catalog', 'customers', 'orders', 'inventory', 'pos', 'finance']
  return `Você é um engenheiro de software realizando uma extração de produto: transformando a implementação de um cliente em um produto multi-tenant reutilizável.

## Contexto
- **Produto:** ${bp.projectName}
- **Problema que resolve:** ${bp.problem}
- **Solução:** ${bp.solution}
- **Stack:** ${stack}
- **Repo fonte (já copiado para este diretório):** ${sourceRepo}

## Plano de extração em 5 fases — execute uma por vez e aguarde aprovação

### Fase 1 — Limpeza de identidade
Substituir todas as referências específicas do cliente por termos genéricos/configuráveis.
- Identifique strings hardcoded (nome do cliente, marca, WhatsApp fixo, endereço fixo, cores fixas, logo fixo)
- Substitua por variáveis de ambiente ou configurações de banco
- Commit: \`chore: limpeza de identidade — referências do cliente removidas\`

### Fase 2 — Conceito de Tenant
Adicionar suporte multi-tenant nas tabelas principais. Se usar Prisma/SQL:
- Adicionar \`tenant_id\` (UUID, NOT NULL) nas tabelas: products, categories, customers, orders, order_items, stock_movements, users, settings
- Adicionar índices em \`tenant_id\` nas tabelas de acesso frequente
- Criar migration
- Commit: \`feat: adicionar tenant_id nas tabelas principais\`

### Fase 3 — Tabela de configurações por tenant
Criar tabela \`store_settings\` (ou equivalente na stack usada) com campos:
tenant_id, store_name, logo_url, primary_color, secondary_color, whatsapp, email, address, delivery_enabled, ecommerce_enabled, pos_enabled
- Commit: \`feat: store_settings — configurações por tenant\`

### Fase 4 — Reorganização em módulos
Reorganizar o código em módulos separados por domínio:
${modules.map(m => `- \`src/modules/${m}/\` com actions/, components/, schemas/, services/, repositories/`).join('\n')}
Mover arquivos existentes para os módulos corretos. Não precisa criar tudo — organize o que já existe.
- Commit: \`refactor: modularização por domínio de negócio\`

### Fase 5 — Documentação e setup
- Atualizar README.md com nome do produto, visão geral e setup
- Verificar se .env.example tem todas as variáveis necessárias (incluindo TENANT_ID para dev)
- Commit: \`docs: README e .env.example atualizados para produto multi-tenant\`

---
Comece pela Fase 1. Ao concluir cada fase, escreva [[RAYZEN:STEP_DONE]] e aguarde aprovação antes de continuar.`
}

export default function DiscoveryPage() {
  const router = useRouter()
  const [projectName, setProjectName] = useState('')
  const [mode, setMode] = useState<CreationMode>('new')
  const [sourceRepo, setSourceRepo] = useState('')
  const [feed, setFeed] = useState<DiscoveryMsg[]>([])
  const [input, setInput] = useState('')
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [enoughInfo, setEnoughInfo] = useState(false)
  const [sending, setSending] = useState(false)
  const [blueprint, setBlueprint] = useState<Blueprint | null>(null)
  const [generating, setGenerating] = useState(false)
  const [creating, setCreating] = useState(false)
  const [result, setResult] = useState<CreateResult | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const feedEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => { feedEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [feed])

  const sendMessage = useCallback(async () => {
    if (!input.trim() || sending) return
    const content = input.trim()
    setInput('')
    setFeed((f) => [...f, { role: 'user', content }])
    setSending(true); setNote(null)
    try {
      const res = await fetch(`${V2_URL}/discovery/message`, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ content, sessionId: sessionId ?? undefined, projectName: projectName.trim() || undefined }),
      })
      if (!res.ok) { setNote(`Erro ao enviar (HTTP ${res.status})`); return }
      const data = await res.json() as MessageResponse
      const wasReady = enoughInfo
      setSessionId(data.sessionId)
      setEnoughInfo(data.enoughInfo)
      setFeed((f) => {
        const next = [...f, { role: 'assistant' as const, content: data.reply }]
        if (data.enoughInfo && !wasReady) {
          next.push({ role: 'assistant', content: '✓ Tenho o suficiente para montar o Blueprint. Adicione mais detalhes se quiser, ou clique em "gerar Blueprint".' })
        }
        return next
      })
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'falha ao enviar')
    } finally { setSending(false) }
  }, [input, sessionId, sending, projectName, enoughInfo])

  const generateBlueprint = useCallback(async () => {
    if (!sessionId || generating) return
    setGenerating(true); setNote(null)
    try {
      const res = await fetch(`${V2_URL}/discovery/${sessionId}/blueprint`, {
        method: 'POST',
        headers: authHeaders(),
      })
      if (!res.ok) { setNote(`Erro ao gerar Blueprint (HTTP ${res.status})`); return }
      setBlueprint(await res.json() as Blueprint)
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'falha ao gerar Blueprint')
    } finally { setGenerating(false) }
  }, [sessionId, generating])

  const approveAndCreate = useCallback(async () => {
    if (!sessionId || !blueprint || creating) return
    setCreating(true); setNote(null)
    try {
      // 1. Gera spec a partir do blueprint revisado
      const specRes = await fetch(`${V2_URL}/discovery/${sessionId}/spec`, {
        method: 'POST',
        headers: authHeaders(),
      })
      if (!specRes.ok) { setNote(`Erro ao montar a spec (HTTP ${specRes.status})`); return }
      const spec = await specRes.json() as ProjectSpec

      // 2. Cria a pasta do projeto
      const dispatchPayload = mode === 'extract'
        ? { action: 'create_project_folder', payload: { name: blueprint.projectName, template: 'extract_from_client', sourceRepo: sourceRepo.trim(), brief: blueprint.brief, spec } }
        : { action: 'create_project_folder', payload: { name: blueprint.projectName, template: 'rayzen', brief: blueprint.brief, spec } }

      const dispatchRes = await fetch(`${API_URL}/execution/dispatch`, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(dispatchPayload),
      })
      if (!dispatchRes.ok) {
        setNote(`Erro ao criar projeto (HTTP ${dispatchRes.status}). O agent desktop está rodando?`)
        return
      }
      const createResult = await dispatchRes.json() as CreateResult
      setResult(createResult)

      // 3. Se extract_from_client, inicia sessão supervisionada de extração e redireciona
      if (createResult.needsExtractionSession && createResult.projectId) {
        const prompt = buildExtractionPrompt(blueprint, sourceRepo.trim())
        const sessionRes = await fetch(`${API_URL}/agent/session`, {
          method: 'POST',
          headers: authHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ projectId: createResult.projectId, prompt }),
        })
        if (sessionRes.ok) {
          const sess = await sessionRes.json() as { id: string }
          router.push(`/work-panel?session=${sess.id}`)
          return
        }
      }
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'falha ao criar projeto')
    } finally { setCreating(false) }
  }, [sessionId, blueprint, creating, mode, sourceRepo, router])

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: '20px 16px', minHeight: '100vh', display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Header */}
      <div className="hud-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span className="hud-title">RAYZEN</span>
          <span style={{ color: 'var(--hud-dim)' }}>·</span>
          <span style={{ fontSize: 13, color: 'var(--hud-text-2)' }}>descoberta de projeto</span>
        </div>
        <Link href="/" className="hud-btn" style={{ fontSize: 12 }}>← painel</Link>
      </div>

      {!result && (
        <>
          {/* Modo de criação */}
          <div className="hud-surface" style={{ padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span style={{ color: 'var(--hud-text-2)', fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5 }}>Modo</span>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                className={mode === 'new' ? 'hud-btn hud-btn-primary' : 'hud-btn'}
                style={{ fontSize: 12 }}
                onClick={() => setMode('new')}
              >
                Novo projeto
              </button>
              <button
                className={mode === 'extract' ? 'hud-btn hud-btn-primary' : 'hud-btn'}
                style={{ fontSize: 12 }}
                onClick={() => setMode('extract')}
              >
                Extrair de implementação existente
              </button>
            </div>

            {mode === 'extract' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ color: 'var(--hud-text-2)', fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  Caminho do repositório fonte
                </span>
                <input
                  className="hud-input"
                  style={{ width: '100%' }}
                  placeholder="ex.: C:\Users\marce\Desktop\Projects\vb-ferragens"
                  value={sourceRepo}
                  onChange={(e) => setSourceRepo(e.target.value)}
                />
                <span style={{ fontSize: 11, color: 'var(--hud-dim)' }}>
                  O código será copiado para o novo projeto. Uma sessão supervisionada executará a extração (limpeza de identidade, multi-tenant, modularização).
                </span>
              </div>
            )}
          </div>

          {/* Nome do projeto */}
          <div className="hud-surface" style={{ padding: '8px 12px' }}>
            <span style={{ color: 'var(--hud-text-2)', fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5 }}>Nome do projeto</span>
            <input
              className="hud-input"
              style={{ width: '100%', marginTop: 4 }}
              placeholder="ex.: Rayzen Commerce Platform"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
            />
          </div>

          {/* Conversa de descoberta */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8, overflowY: 'auto', minHeight: 180 }}>
            {feed.length === 0 && (
              <div className="hud-empty" style={{ margin: 'auto', textAlign: 'center', color: 'var(--hud-dim)' }}>
                {mode === 'extract'
                  ? 'Descreva o produto que quer extrair e qual cliente serviu de base.\nO Rayzen conduz a entrevista e monta o Blueprint.'
                  : 'Conte a ideia ou a dor do cliente.\nO Rayzen conduz a entrevista e monta o Blueprint.'}
              </div>
            )}
            {feed.map((m, i) => (
              <div key={i} className={m.role === 'user' ? 'hud-msg-user' : 'hud-msg-ai'}>{m.content}</div>
            ))}
            {sending && <div className="hud-msg-ai hud-pulse" style={{ color: 'var(--hud-dim)' }}>pensando…</div>}
            <div ref={feedEndRef} />
          </div>

          {note && <div style={{ color: '#ef4444', fontSize: 12 }}>{note}</div>}

          {/* Input + ações */}
          <div className="hud-input-bar" style={{ display: 'flex', gap: 8 }}>
            <input
              className="hud-input"
              style={{ flex: 1 }}
              placeholder="responder…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void sendMessage() } }}
            />
            <button className="hud-btn" onClick={sendMessage} disabled={sending || !input.trim()}>enviar</button>
            <button
              className="hud-btn hud-btn-primary"
              onClick={generateBlueprint}
              disabled={generating || !sessionId}
              title={enoughInfo ? 'há contexto suficiente para um Blueprint' : 'gera o Blueprint com o que já foi conversado'}
              style={enoughInfo ? { boxShadow: '0 0 0 1px var(--hud-cyan-40)' } : undefined}
            >
              {generating ? 'gerando…' : 'gerar Blueprint'}
            </button>
          </div>
        </>
      )}

      {/* Revisão do Blueprint */}
      {blueprint && !result && (
        <div className="hud-card" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <span style={{ fontSize: 15, fontWeight: 600 }}>{blueprint.projectName}</span>
            <span style={{ fontSize: 11, color: 'var(--hud-dim)' }}>{blueprint.segment}</span>
          </div>

          {mode === 'extract' && sourceRepo && (
            <div style={{ fontSize: 12, padding: '6px 10px', background: 'var(--hud-bg)', borderRadius: 4, color: 'var(--hud-text-2)' }}>
              Extração de <code style={{ fontSize: 11 }}>{sourceRepo}</code>
              <span style={{ color: 'var(--hud-dim)', marginLeft: 8 }}>→ sessão supervisionada executará as 5 fases automaticamente</span>
            </div>
          )}

          <Section title="Problema">{blueprint.problem}</Section>
          <Section title="Solução">{blueprint.solution}</Section>

          {blueprint.painPoints?.length > 0 && (
            <Section title="Dores">
              {blueprint.painPoints.map((p, i) => (
                <div key={i} style={{ fontSize: 13 }}>
                  <span style={{ color: SEV_COLOR[p.severity] ?? 'var(--hud-dim)' }}>●</span> {p.description}
                </div>
              ))}
            </Section>
          )}

          {blueprint.personas?.length > 0 && (
            <Section title="Personas">
              {blueprint.personas.map((p, i) => (
                <div key={i} style={{ fontSize: 13 }}><b>{p.name}</b> ({p.role}) — {p.pain}</div>
              ))}
            </Section>
          )}

          {blueprint.requirements?.length > 0 && (
            <Section title="Requisitos">
              {blueprint.requirements.map((r) => (
                <div key={r.id} style={{ fontSize: 13 }}>
                  <span style={{ color: 'var(--hud-cyan)' }}>{r.id}</span> [{r.priority}] {r.description}
                </div>
              ))}
            </Section>
          )}

          {blueprint.businessRules?.length > 0 && (
            <Section title="Regras de negócio">
              {blueprint.businessRules.map((r) => (
                <div key={r.id} style={{ fontSize: 13 }}>
                  <span style={{ color: 'var(--hud-cyan)' }}>{r.id}</span> [{r.enforcement}] {r.description}
                </div>
              ))}
            </Section>
          )}

          {blueprint.opportunities?.length > 0 && (
            <Section title="Oportunidades (não pedidas)">
              {blueprint.opportunities.map((o, i) => (
                <div key={i} style={{ fontSize: 13 }}>
                  <b>{o.title}</b> <span style={{ color: 'var(--hud-dim)' }}>(valor {o.value} / esforço {o.effort})</span> — {o.description}
                </div>
              ))}
            </Section>
          )}

          {blueprint.stack?.length > 0 && (
            <Section title="Stack">
              {blueprint.stack.map((s, i) => (
                <div key={i} style={{ fontSize: 13 }}><b>{s.layer}:</b> {s.tech}</div>
              ))}
            </Section>
          )}

          {blueprint.integrations?.length > 0 && (
            <Section title="Integrações">{blueprint.integrations.join(', ')}</Section>
          )}

          {note && <div style={{ color: '#ef4444', fontSize: 12 }}>{note}</div>}

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="hud-btn" onClick={() => setBlueprint(null)} disabled={creating}>continuar conversa</button>
            <button
              className="hud-btn hud-btn-primary"
              onClick={approveAndCreate}
              disabled={creating || (mode === 'extract' && !sourceRepo.trim())}
            >
              {creating
                ? (mode === 'extract' ? 'copiando e iniciando extração…' : 'criando projeto…')
                : (mode === 'extract' ? 'aprovar e iniciar extração' : 'aprovar e criar projeto')}
            </button>
          </div>
        </div>
      )}

      {/* Resultado da criação (modo new — extract redireciona direto pro work-panel) */}
      {result && (
        <div className="hud-card" style={{ padding: 16, borderColor: '#22c55e', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ color: '#22c55e', fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5 }}>✓ projeto criado</div>
          <div style={{ fontSize: 13 }}><b>Pasta:</b> {result.path}</div>
          {result.projectId && <div style={{ fontSize: 13 }}><b>projectId:</b> <code>{result.projectId}</code></div>}
          {result.repoSlug && <div style={{ fontSize: 13 }}><b>repoSlug:</b> {result.repoSlug}</div>}
          {result.filesGenerated?.length ? (
            <div style={{ fontSize: 12, color: 'var(--hud-text-2)' }}>
              {result.filesGenerated.length} arquivos: {result.filesGenerated.join(', ')}
            </div>
          ) : null}
          <div style={{ fontSize: 12, color: 'var(--hud-dim)' }}>
            Docs, git e hook do Claude Code já configurados (padrão Rayzen). O VS Code deve ter aberto na pasta.
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Link href="/work-panel" className="hud-btn hud-btn-primary" style={{ fontSize: 12 }}>ir para o Work Panel</Link>
            <Link href="/" className="hud-btn" style={{ fontSize: 12 }}>painel</Link>
          </div>
        </div>
      )}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ color: 'var(--hud-text-2)', fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 3 }}>{title}</div>
      <div style={{ fontSize: 13, display: 'flex', flexDirection: 'column', gap: 3 }}>{children}</div>
    </div>
  )
}
