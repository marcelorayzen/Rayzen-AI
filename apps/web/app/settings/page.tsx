'use client'

export const dynamic = 'force-dynamic'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { getApiUrl, getApiUrlInputDefault, setApiUrl } from '../../lib/api-url'

function authHeaders(extra?: Record<string, string>): Record<string, string> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('rayzen_token') : null
  return {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    'ngrok-skip-browser-warning': 'true',
    ...(extra ?? {}),
  }
}

interface RayzenConfig {
  identity: { name: string; language: string; personality: string }
  modules: Record<string, boolean>
  llm: Record<string, { model: string; temperature: number }>
  agent: {
    pollIntervalMs: number
    actions: Record<string, boolean>
    sandbox: { paths: string[]; allowedApps: string[]; allowedDomains: string[] }
    security: Record<string, boolean>
  }
  tts: { provider: string; voice: string }
  obsidian: { vaultPath: string; vaultName: string }
}

type Tab = 'identity' | 'modules' | 'llm' | 'agent' | 'security' | 'tts' | 'obsidian'

interface UsageStats {
  provider: 'groq' | 'claude'
  pricing: {
    groq:   { model: string; costPerMToken: number }
    claude: { model: string; costPerMToken: number }
  }
  today:   { tokens: number; messages: number; costUSD: number }
  week:    { tokens: number; messages: number; costUSD: number }
  month:   { tokens: number; messages: number; costUSD: number }
  allTime: { tokens: number; messages: number; costUSD: number }
}

const TABS: { id: Tab; label: string }[] = [
  { id: 'identity', label: 'Identidade' },
  { id: 'modules', label: 'Módulos' },
  { id: 'llm', label: 'LLM' },
  { id: 'agent', label: 'Agent' },
  { id: 'security', label: 'Segurança' },
  { id: 'tts', label: 'Voz' },
  { id: 'obsidian', label: 'Obsidian' },
]

const ACTION_LABELS: Record<string, string> = {
  open_app: 'Abrir aplicativo', open_url: 'Abrir URL', open_vscode: 'Abrir VS Code',
  list_dir: 'Listar diretório', file_search: 'Buscar arquivo', organize_downloads: 'Organizar downloads',
  create_project_folder: 'Criar projeto', get_system_info: 'Info do sistema',
  screenshot: 'Screenshot', notify: 'Notificação', clipboard_read: 'Ler clipboard', clipboard_write: 'Escrever clipboard',
  git_status: 'Git status', git_log: 'Git log', git_branch: 'Git branch', git_commit: 'Git commit',
  run_command: 'Rodar comando', docker_ps: 'Docker ps', docker_start: 'Docker start', docker_stop: 'Docker stop',
  read_emails: 'Ler emails', send_email: 'Enviar email', get_calendar: 'Agenda',
}

const MODULE_LABELS: Record<string, string> = {
  brain: 'Brain (memória semântica)', jarvis: 'Jarvis (tarefas locais)',
  doc: 'Doc Engine (PDF/DOCX)', content: 'Content Studio', tts: 'TTS (voz)', stt: 'STT (microfone)',
}

export default function SettingsPage() {
  const [config, setConfig] = useState<RayzenConfig | null>(null)
  const [apiUrlInput, setApiUrlInput] = useState('')
  const [activeTab, setActiveTab] = useState<Tab>('identity')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [usage, setUsage] = useState<UsageStats | null>(null)
  const [switchingProvider, setSwitchingProvider] = useState(false)
  const [providerMsg, setProviderMsg] = useState('')
  const router = useRouter()

  const loadConfig = useCallback(async () => {
    const resolvedInput = apiUrlInput.trim() || getApiUrlInputDefault()
    if (resolvedInput && resolvedInput !== apiUrlInput) {
      setApiUrlInput(resolvedInput)
    }

    const token = localStorage.getItem('rayzen_token')
    if (!token) {
      router.push('/login')
      return
    }

    const apiUrl = resolvedInput || getApiUrl()
    if (!apiUrl) {
      setError('URL da API não configurada. Volte ao login e informe a URL pública da API.')
      setLoading(false)
      return
    }

    setLoading(true)
    setError('')
    try {
      const res = await fetch(`${apiUrl}/configuration`, { headers: authHeaders() })
      if (res.status === 401) {
        localStorage.removeItem('rayzen_token')
        router.push('/login')
        return
      }
      if (!res.ok) {
        throw new Error(`Erro ao carregar configuração (${res.status})`)
      }
      setConfig(await res.json() as RayzenConfig)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar configuração')
    } finally {
      setLoading(false)
    }
  }, [apiUrlInput, router])

  const loadUsage = useCallback(async () => {
    const apiUrl = getApiUrl()
    if (!apiUrl) return
    try {
      const res = await fetch(`${apiUrl}/configuration/usage`, { headers: authHeaders() })
      if (res.ok) setUsage(await res.json() as UsageStats)
    } catch { /* silencioso */ }
  }, [])

  const switchProvider = useCallback(async (provider: 'groq' | 'claude') => {
    setSwitchingProvider(true)
    setProviderMsg('')
    try {
      const apiUrl = getApiUrl()
      const res = await fetch(`${apiUrl}/configuration/llm-provider`, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ provider }),
      })
      if (!res.ok) throw new Error(`Erro ${res.status}`)
      setProviderMsg(`Provedor alterado para ${provider === 'groq' ? 'Groq' : 'Claude'}. LiteLLM reiniciado.`)
      await loadUsage()
    } catch (err) {
      setProviderMsg(`Erro: ${err instanceof Error ? err.message : 'falhou'}`)
    } finally {
      setSwitchingProvider(false)
    }
  }, [loadUsage])

  useEffect(() => {
    setApiUrlInput(getApiUrlInputDefault())
  }, [])

  useEffect(() => {
    if (!apiUrlInput) return
    loadConfig()
    loadUsage()
  }, [apiUrlInput, loadConfig, loadUsage])

  const save = useCallback(async () => {
    if (!config) return
    setSaving(true)
    setError('')
    try {
      const resolvedApiUrl = setApiUrl(apiUrlInput)
      if (!resolvedApiUrl) {
        throw new Error('Informe a URL da API antes de salvar.')
      }

      const res = await fetch(`${resolvedApiUrl}/configuration`, {
        method: 'PATCH',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(config),
      })
      if (res.status === 401) {
        localStorage.removeItem('rayzen_token')
        router.push('/login')
        return
      }
      if (!res.ok) {
        throw new Error(`Erro ao salvar configuração (${res.status})`)
      }

      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao salvar configuração')
    } finally {
      setSaving(false)
    }
  }, [apiUrlInput, config, router])

  const update = (path: string[], value: unknown) => {
    setConfig((prev) => {
      if (!prev) return prev
      const next = JSON.parse(JSON.stringify(prev)) as RayzenConfig
      let obj: Record<string, unknown> = next as unknown as Record<string, unknown>
      for (let i = 0; i < path.length - 1; i++) obj = obj[path[i]] as Record<string, unknown>
      obj[path[path.length - 1]] = value
      return next
    })
  }

  if (loading) return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center text-zinc-500 text-sm">
      Carregando configurações...
    </div>
  )

  if (!config) return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center px-4">
      <div className="w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-2xl p-6">
        <p className="text-sm text-red-400 text-center">{error || 'Não foi possível carregar as configurações.'}</p>
        <div className="mt-4">
          <label className="block text-xs font-medium text-zinc-300 mb-2">URL da API</label>
          <input
            value={apiUrlInput}
            onChange={(e) => setApiUrlInput(e.target.value)}
            placeholder="https://api-seu-rayzen.ngrok-free.app"
            className="w-full bg-zinc-800 rounded-xl px-4 py-3 text-sm text-zinc-100 placeholder:text-zinc-500 outline-none focus:ring-2 focus:ring-zinc-600"
          />
        </div>
        <div className="mt-4 flex items-center justify-center gap-3">
          <button
            onClick={() => {
              setApiUrl(apiUrlInput)
              loadConfig()
            }}
            className="bg-zinc-100 text-zinc-900 rounded-xl px-4 py-2 text-sm font-medium hover:bg-white transition-colors"
          >
            Tentar novamente
          </button>
          <button
            onClick={() => {
              localStorage.removeItem('rayzen_token')
              router.push('/login')
            }}
            className="text-zinc-400 hover:text-zinc-200 text-sm transition-colors"
          >
            login
          </button>
          <button onClick={() => router.push('/')} className="text-zinc-400 hover:text-zinc-200 text-sm transition-colors">
            voltar
          </button>
        </div>
      </div>
    </div>
  )

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="max-w-3xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-xl font-semibold">Configurações</h1>
            <p className="text-xs text-zinc-500 mt-0.5">rayzen.config.json</p>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={() => router.push('/')} className="text-zinc-500 hover:text-zinc-300 text-sm transition-colors">
              ← voltar
            </button>
            <button
              onClick={save}
              disabled={saving}
              className="bg-zinc-100 text-zinc-900 rounded-xl px-5 py-2 text-sm font-medium disabled:opacity-40 hover:bg-white transition-colors"
            >
              {saving ? 'Salvando...' : saved ? 'Salvo ✓' : 'Salvar'}
            </button>
          </div>
        </div>

        <div className="flex gap-1 mb-6 bg-zinc-900 rounded-xl p-1 border border-zinc-800">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex-1 py-2 rounded-lg text-xs font-medium transition-colors ${activeTab === tab.id ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'}`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="space-y-4">
          {error && (
            <div className="bg-red-950/40 border border-red-900/60 rounded-xl px-4 py-3 text-sm text-red-300">
              {error}
            </div>
          )}

          {activeTab === 'identity' && (
            <Field label="URL da API" hint="Use a URL publica da API quando o Web estiver hospedado fora do notebook">
              <input
                value={apiUrlInput}
                onChange={(e) => setApiUrlInput(e.target.value)}
                placeholder="https://api-seu-rayzen.ngrok-free.app"
                className="input"
              />
            </Field>
          )}

          {activeTab === 'identity' && (
            <>
              <Field label="Nome do assistente" hint="Como ele se apresenta nas respostas">
                <input value={config.identity.name} onChange={(e) => update(['identity', 'name'], e.target.value)} className="input" />
              </Field>
              <Field label="Idioma" hint="Código de idioma (ex: pt-BR, en-US, es-ES)">
                <input value={config.identity.language} onChange={(e) => update(['identity', 'language'], e.target.value)} className="input" />
              </Field>
              <Field label="Personalidade" hint="System prompt base - define tom, estilo e comportamento">
                <textarea value={config.identity.personality} onChange={(e) => update(['identity', 'personality'], e.target.value)} rows={5} className="input resize-none" />
              </Field>
            </>
          )}

          {activeTab === 'modules' && (
            <div className="space-y-2">
              {Object.entries(config.modules).map(([key, enabled]) => (
                <Toggle key={key} label={MODULE_LABELS[key] ?? key} value={enabled} onChange={(v) => update(['modules', key], v)} />
              ))}
            </div>
          )}

          {activeTab === 'llm' && (
            <div className="space-y-4">

              {/* Provedor ativo */}
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
                <p className="text-xs font-semibold text-zinc-400 mb-3 uppercase tracking-wide">Provedor LLM</p>
                <div className="grid grid-cols-2 gap-3">
                  {(['groq', 'claude'] as const).map((p) => {
                    const active = usage?.provider === p
                    const labels = { groq: 'Groq — Llama 3.3 70B', claude: 'Claude — Sonnet 4' }
                    const costs  = { groq: '$0.70/MTok', claude: '$9.00/MTok' }
                    return (
                      <button
                        key={p}
                        onClick={() => !active && switchProvider(p)}
                        disabled={switchingProvider}
                        className={`rounded-xl px-4 py-3 text-left transition-all border ${
                          active
                            ? 'bg-zinc-700 border-zinc-500 text-zinc-100'
                            : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200'
                        } disabled:opacity-50`}
                      >
                        <p className="text-sm font-medium">{labels[p]}</p>
                        <p className="text-xs text-zinc-500 mt-0.5">{costs[p]} estimado</p>
                        {active && <p className="text-xs text-emerald-400 mt-1">ativo</p>}
                      </button>
                    )
                  })}
                </div>
                {switchingProvider && (
                  <p className="text-xs text-zinc-400 mt-3">Reiniciando LiteLLM... (pode levar ~15s)</p>
                )}
                {providerMsg && !switchingProvider && (
                  <p className={`text-xs mt-3 ${providerMsg.startsWith('Erro') ? 'text-red-400' : 'text-emerald-400'}`}>
                    {providerMsg}
                  </p>
                )}
              </div>

              {/* Uso & Custo */}
              {usage && (
                <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wide">Uso & Custo Estimado</p>
                    <button onClick={loadUsage} className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors">↻ atualizar</button>
                  </div>
                  <div className="grid grid-cols-4 gap-2 text-center">
                    {([
                      { label: 'Hoje',    data: usage.today   },
                      { label: '7 dias',  data: usage.week    },
                      { label: 'Mês',     data: usage.month   },
                      { label: 'Total',   data: usage.allTime },
                    ] as const).map(({ label, data }) => (
                      <div key={label} className="bg-zinc-800 rounded-lg p-3">
                        <p className="text-xs text-zinc-500 mb-1">{label}</p>
                        <p className="text-sm font-semibold text-zinc-100">
                          {data.tokens >= 1_000_000
                            ? `${(data.tokens / 1_000_000).toFixed(1)}M`
                            : data.tokens >= 1_000
                              ? `${(data.tokens / 1_000).toFixed(1)}k`
                              : data.tokens}
                        </p>
                        <p className="text-xs text-zinc-400">tokens</p>
                        <p className="text-xs text-amber-400 mt-1">${data.costUSD.toFixed(4)}</p>
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-zinc-600 mt-3">
                    Custo baseado em taxa blended (input+output). Valores reais podem variar.
                    {usage.provider === 'groq' ? ' Groq tem tier gratuito — custo real pode ser $0.' : ''}
                  </p>
                </div>
              )}

              {/* Config por módulo */}
              {Object.entries(config.llm).map(([module, cfg]) => (
                <div key={module} className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
                  <p className="text-xs font-semibold text-zinc-400 mb-3 uppercase tracking-wide">{module}</p>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Modelo" compact>
                      <input value={cfg.model} onChange={(e) => update(['llm', module, 'model'], e.target.value)} className="input text-xs" />
                    </Field>
                    <Field label={`Temperature: ${cfg.temperature}`} compact>
                      <input type="range" min="0" max="1" step="0.1" value={cfg.temperature} onChange={(e) => update(['llm', module, 'temperature'], parseFloat(e.target.value))} className="w-full accent-zinc-400 mt-2" />
                    </Field>
                  </div>
                </div>
              ))}
            </div>
          )}

          {activeTab === 'agent' && (
            <>
              <Field label="Intervalo de polling (ms)" hint="Com que frequência o agent verifica novas tarefas">
                <input type="number" value={config.agent.pollIntervalMs} onChange={(e) => update(['agent', 'pollIntervalMs'], parseInt(e.target.value))} className="input" min={500} max={30000} step={500} />
              </Field>

              <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
                <p className="text-xs font-semibold text-zinc-400 mb-3 uppercase tracking-wide">Ações disponíveis</p>
                <div className="grid grid-cols-2 gap-2">
                  {Object.entries(config.agent.actions).map(([action, enabled]) => (
                    <Toggle key={action} label={ACTION_LABELS[action] ?? action} small value={enabled} onChange={(v) => update(['agent', 'actions', action], v)} />
                  ))}
                </div>
              </div>

              <Field label="Pastas permitidas (sandbox)" hint="Uma por linha - use ~ para home do usuário">
                <textarea value={config.agent.sandbox.paths.join('\n')} onChange={(e) => update(['agent', 'sandbox', 'paths'], e.target.value.split('\n').filter(Boolean))} rows={4} className="input resize-none text-xs font-mono" />
              </Field>

              <Field label="Aplicativos permitidos" hint="Separados por vírgula">
                <input value={config.agent.sandbox.allowedApps.join(', ')} onChange={(e) => update(['agent', 'sandbox', 'allowedApps'], e.target.value.split(',').map((s) => s.trim()).filter(Boolean))} className="input" />
              </Field>

              <Field label="Domínios permitidos (open_url)" hint="Separados por vírgula">
                <input value={config.agent.sandbox.allowedDomains.join(', ')} onChange={(e) => update(['agent', 'sandbox', 'allowedDomains'], e.target.value.split(',').map((s) => s.trim()).filter(Boolean))} className="input" />
              </Field>
            </>
          )}

          {activeTab === 'security' && (
            <div className="space-y-2">
              <p className="text-xs text-zinc-500 mb-4">
                Ações com dryRun ativo simulam a execução sem fazer nada de verdade.
                Desative apenas quando tiver certeza do comportamento.
              </p>
              {Object.entries(config.agent.security).map(([key, value]) => (
                <Toggle key={key} label={key.replace(/([A-Z])/g, ' $1').replace('Dry Run', '→ dryRun').toLowerCase()} value={value} onChange={(v) => update(['agent', 'security', key], v)} />
              ))}
            </div>
          )}

          {activeTab === 'tts' && (
            <>
              <Field label="Provider" hint="groq ou elevenlabs">
                <select value={config.tts.provider} onChange={(e) => update(['tts', 'provider'], e.target.value)} className="input">
                  <option value="groq">Groq (Orpheus)</option>
                  <option value="elevenlabs">ElevenLabs (PT-BR nativo)</option>
                </select>
              </Field>
              <Field label="Voz" hint="Groq: daniel, austin, troy, autumn, diana, hannah">
                <input value={config.tts.voice} onChange={(e) => update(['tts', 'voice'], e.target.value)} className="input" />
              </Field>
            </>
          )}

          {activeTab === 'obsidian' && (
            <>
              <Field label="Caminho do vault" hint="Caminho absoluto da pasta do vault no sistema onde a API roda. Ex: C:/Users/marce/Documents/Obsidian/meu-vault">
                <input value={config.obsidian?.vaultPath ?? ''} onChange={(e) => update(['obsidian', 'vaultPath'], e.target.value)} placeholder="C:/Users/marce/Documents/Obsidian/meu-vault" className="input" />
              </Field>
              <Field label="Nome do vault" hint="Nome exato do vault no Obsidian (usado para os deep links obsidian://open)">
                <input value={config.obsidian?.vaultName ?? ''} onChange={(e) => update(['obsidian', 'vaultName'], e.target.value)} placeholder="meu-vault" className="input" />
              </Field>
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
                <p className="text-xs text-zinc-500">Após salvar, os documentos gerados em <strong className="text-zinc-400">Documentação viva</strong> serão sincronizados para:</p>
                <code className="block mt-2 text-xs text-indigo-400">{config.obsidian?.vaultPath ? `${config.obsidian.vaultPath}/Rayzen/<projeto>/` : '<vault path>/Rayzen/<projeto>/'}</code>
              </div>
            </>
          )}
        </div>
      </div>
    </main>
  )
}

function Field({ label, hint, children, compact }: {
  label: string; hint?: string; children: React.ReactNode; compact?: boolean
}) {
  return (
    <div className={compact ? '' : 'bg-zinc-900 border border-zinc-800 rounded-xl p-4'}>
      <label className="block text-xs font-medium text-zinc-300 mb-1">{label}</label>
      {hint && <p className="text-xs text-zinc-600 mb-2">{hint}</p>}
      {children}
    </div>
  )
}

function Toggle({ label, value, onChange, small }: {
  label: string; value: boolean; onChange: (v: boolean) => void; small?: boolean
}) {
  return (
    <div
      onClick={() => onChange(!value)}
      className={`flex items-center justify-between cursor-pointer rounded-lg px-3 py-2 transition-colors ${small ? 'hover:bg-zinc-800' : 'bg-zinc-900 border border-zinc-800 hover:border-zinc-700'}`}
    >
      <span className={`text-zinc-300 ${small ? 'text-xs' : 'text-sm'}`}>{label}</span>
      <div className={`w-9 h-5 rounded-full transition-colors flex items-center px-0.5 ${value ? 'bg-zinc-300' : 'bg-zinc-700'}`}>
        <div className={`w-4 h-4 rounded-full bg-zinc-900 transition-transform ${value ? 'translate-x-4' : 'translate-x-0'}`} />
      </div>
    </div>
  )
}

