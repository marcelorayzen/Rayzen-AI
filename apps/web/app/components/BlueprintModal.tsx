'use client'

import { API_URL } from '../../lib/api-url'
import { authHeaders } from '../../lib/api-client'

interface BlueprintHistoryItem {
  id: string
  title: string
  source: string
  format: string
  mode: string | null
  wikiPages: string[]
  eventCount: number
  nextSteps: string[]
  warnings: string[]
  createdAt: string
}

interface BlueprintUploadPreview {
  detectedSections: string[]
  suggestedWikiPages: string[]
  suggestedNextSteps: string[]
  risks: string[]
}

interface BlueprintUploadResult {
  ok: boolean
  created: { wikiPages: string[]; events: string[]; nextSteps: string[] }
  warnings: string[]
}

interface BlueprintModalProps {
  activeProjectId: string | null
  blueprintTab: 'templates' | 'history' | 'upload'
  setBlueprintTab: (tab: 'templates' | 'history' | 'upload') => void
  blueprintCopied: string | null
  setBlueprintCopied: (key: string | null) => void
  blueprintHistory: BlueprintHistoryItem[]
  setBlueprintHistory: (history: BlueprintHistoryItem[]) => void
  blueprintHistoryLoading: boolean
  setBlueprintHistoryLoading: (loading: boolean) => void
  blueprintUploadFileName: string
  setBlueprintUploadFileName: (name: string) => void
  blueprintUploadTitle: string
  setBlueprintUploadTitle: (title: string) => void
  blueprintUploadContent: string
  setBlueprintUploadContent: (content: string) => void
  blueprintUploadPreview: BlueprintUploadPreview | null
  setBlueprintUploadPreview: (preview: BlueprintUploadPreview | null) => void
  blueprintUploadResult: BlueprintUploadResult | null
  setBlueprintUploadResult: (result: BlueprintUploadResult | null) => void
  blueprintUploadLoading: boolean
  setBlueprintUploadLoading: (loading: boolean) => void
  onClose: () => void
}

export function BlueprintModal({
  activeProjectId, blueprintTab, setBlueprintTab, blueprintCopied, setBlueprintCopied,
  blueprintHistory, setBlueprintHistory, blueprintHistoryLoading, setBlueprintHistoryLoading,
  blueprintUploadFileName, setBlueprintUploadFileName, blueprintUploadTitle, setBlueprintUploadTitle,
  blueprintUploadContent, setBlueprintUploadContent, blueprintUploadPreview, setBlueprintUploadPreview,
  blueprintUploadResult, setBlueprintUploadResult, blueprintUploadLoading, setBlueprintUploadLoading,
  onClose,
}: BlueprintModalProps) {
  const loadHistory = async () => {
    if (!activeProjectId) return
    setBlueprintHistoryLoading(true)
    try {
      const res = await fetch(`${API_URL}/projects/${activeProjectId}/blueprint/imports`, { headers: authHeaders() })
      if (res.ok) setBlueprintHistory(await res.json())
    } finally {
      setBlueprintHistoryLoading(false)
    }
  }

  const PROMPT_FULL = `Estruture esta ideia no modelo Rayzen Blueprint.

Quero um Blueprint em Markdown pronto para importar no Rayzen AI usando \`rayzen_blueprint_import_markdown\`.

Use esta estrutura:

# [Nome da Ideia / Feature / Projeto]

## 1. Resumo executivo
Explique em poucas linhas o que é a ideia e por que ela existe.

## 2. Problema
Descreva o problema real que isso resolve.

## 3. Objetivo
Explique o objetivo principal da implementação.

## 4. Contexto atual
Descreva o que já existe no projeto, o que não existe e quais partes serão aproveitadas.

## 5. Solução proposta
Explique a solução de forma prática e técnica.

## 6. Arquitetura
Descreva os módulos, fluxo, camadas e integrações.

## 7. Endpoints / Interfaces
Liste endpoints, comandos, tools MCP, telas ou funções necessárias.

## 8. DTOs / Dados necessários
Liste os campos, payloads, estruturas JSON ou tipos TypeScript necessários.

## 9. Regras de negócio
Liste regras, validações e comportamentos esperados.

## 10. Decisões técnicas
Liste decisões no formato:
- Decidimos usar X porque Y.

## 11. Problemas / riscos
Liste riscos, blockers e pontos de atenção no formato:
- Problema: ...

## 12. Tarefas de implementação
Liste tarefas acionáveis começando com verbos:
- Implementar ...
- Criar ...
- Adicionar ...
- Validar ...
- Testar ...

## 13. Checklist de validação
Liste como validar que está funcionando.

## 14. Próximos passos
Liste a sequência recomendada de execução.

Ideia bruta:
[COLE AQUI]`

  const PROMPT_SHORT = `Transforme a ideia abaixo em um Rayzen Blueprint pronto para importar com \`rayzen_blueprint_import_markdown\`.

Preciso que venha em Markdown com:
Resumo, Problema, Objetivo, Contexto atual, Solução, Arquitetura, Endpoints/Interfaces, Dados/DTOs, Regras, Decisões, Problemas, Tarefas, Checklist e Próximos passos.

Use frases detectáveis pelo parser:
- Decidimos ...
- Problema: ...
- Implementar ...
- Criar ...
- Adicionar ...
- Testar ...

Ideia:
[COLE AQUI]`

  const copy = (key: string, text: string) => {
    navigator.clipboard.writeText(text)
    setBlueprintCopied(key)
    setTimeout(() => setBlueprintCopied(null), 2000)
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/70 z-40" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
        <div className="bg-zinc-900 border border-zinc-700 rounded-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto pointer-events-auto shadow-2xl">
          <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800 sticky top-0 bg-zinc-900">
            <div className="flex items-center gap-4">
              <span className="text-zinc-100 font-semibold text-sm">Rayzen Blueprint</span>
              <div className="flex gap-1">
                <button
                  onClick={() => setBlueprintTab('templates')}
                  className={`text-xs px-3 py-1 rounded-md transition-colors ${blueprintTab === 'templates' ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'}`}
                >Templates</button>
                <button
                  onClick={() => { setBlueprintTab('history'); loadHistory() }}
                  className={`text-xs px-3 py-1 rounded-md transition-colors ${blueprintTab === 'history' ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'}`}
                >Histórico</button>
                <button
                  onClick={() => { setBlueprintTab('upload'); setBlueprintUploadPreview(null); setBlueprintUploadResult(null) }}
                  className={`text-xs px-3 py-1 rounded-md transition-colors ${blueprintTab === 'upload' ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'}`}
                >Upload</button>
              </div>
            </div>
            <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 text-lg leading-none">×</button>
          </div>

          <div className="px-5 py-4 space-y-5">
          {blueprintTab === 'history' && (
            <div>
              {!activeProjectId && (
                <p className="text-zinc-500 text-xs text-center py-6">Selecione um projeto para ver o histórico.</p>
              )}
              {activeProjectId && blueprintHistoryLoading && (
                <p className="text-zinc-500 text-xs text-center py-6 animate-pulse">Carregando...</p>
              )}
              {activeProjectId && !blueprintHistoryLoading && blueprintHistory.length === 0 && (
                <p className="text-zinc-500 text-xs text-center py-6">Nenhum blueprint importado ainda.</p>
              )}
              {activeProjectId && !blueprintHistoryLoading && blueprintHistory.length > 0 && (
                <div className="space-y-2">
                  {blueprintHistory.map((bp) => (
                    <div key={bp.id} className="bg-zinc-800/60 border border-zinc-700 rounded-lg px-4 py-3">
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-zinc-200 text-xs font-medium leading-snug">{bp.title}</span>
                        <span className="text-zinc-600 text-[10px] shrink-0">{new Date(bp.createdAt).toLocaleDateString('pt-BR')}</span>
                      </div>
                      <div className="flex gap-2 mt-1.5 flex-wrap">
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-700 text-zinc-400">{bp.source}</span>
                        {bp.mode && <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-700 text-zinc-400">{bp.mode}</span>}
                        {bp.wikiPages.length > 0 && <span className="text-[10px] text-emerald-500">{bp.wikiPages.length} wiki</span>}
                        {bp.eventCount > 0 && <span className="text-[10px] text-sky-500">{bp.eventCount} eventos</span>}
                        {bp.nextSteps.length > 0 && <span className="text-[10px] text-violet-400">{bp.nextSteps.length} próx. passos</span>}
                        {bp.warnings.length > 0 && <span className="text-[10px] text-amber-400">{bp.warnings.length} avisos</span>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          {blueprintTab === 'upload' && (
            <div className="space-y-4">
              {/* Drop zone */}
              <label className="block cursor-pointer">
                <div
                  className="border-2 border-dashed border-zinc-700 hover:border-sky-500 rounded-xl p-8 text-center transition-colors"
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault()
                    const file = e.dataTransfer.files[0]
                    if (!file) return
                    setBlueprintUploadFileName(file.name)
                    setBlueprintUploadTitle(file.name.replace(/\.md$/i, '').replace(/[-_]/g, ' '))
                    setBlueprintUploadPreview(null)
                    setBlueprintUploadResult(null)
                    const reader = new FileReader()
                    reader.onload = (ev) => setBlueprintUploadContent(ev.target?.result as string ?? '')
                    reader.readAsText(file)
                  }}
                >
                  {blueprintUploadFileName ? (
                    <div>
                      <p className="text-emerald-400 text-xs font-medium">{blueprintUploadFileName}</p>
                      <p className="text-zinc-600 text-[11px] mt-1">{blueprintUploadContent.length.toLocaleString()} chars</p>
                    </div>
                  ) : (
                    <div>
                      <p className="text-zinc-400 text-xs">Arraste um arquivo <span className="text-sky-400 font-mono">.md</span> aqui</p>
                      <p className="text-zinc-600 text-[11px] mt-1">ou clique para selecionar</p>
                    </div>
                  )}
                </div>
                <input
                  type="file"
                  accept=".md,text/markdown"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (!file) return
                    setBlueprintUploadFileName(file.name)
                    setBlueprintUploadTitle(file.name.replace(/\.md$/i, '').replace(/[-_]/g, ' '))
                    setBlueprintUploadPreview(null)
                    setBlueprintUploadResult(null)
                    const reader = new FileReader()
                    reader.onload = (ev) => setBlueprintUploadContent(ev.target?.result as string ?? '')
                    reader.readAsText(file)
                  }}
                />
              </label>

              {/* Title input */}
              {blueprintUploadContent && (
                <div>
                  <label className="text-zinc-400 text-[11px] uppercase tracking-wider block mb-1">Título</label>
                  <input
                    type="text"
                    value={blueprintUploadTitle}
                    onChange={(e) => setBlueprintUploadTitle(e.target.value)}
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-100 focus:outline-none focus:border-sky-500"
                    placeholder="Título do blueprint"
                  />
                </div>
              )}

              {/* Preview result */}
              {blueprintUploadPreview && !blueprintUploadResult && (
                <div className="bg-zinc-800/60 border border-zinc-700 rounded-lg px-4 py-3 space-y-2">
                  <p className="text-zinc-300 text-[11px] font-semibold uppercase tracking-wider">Preview</p>
                  <div className="text-[11px] text-zinc-400 space-y-1">
                    <p><span className="text-zinc-500">Seções detectadas:</span> {blueprintUploadPreview.detectedSections.join(', ') || '—'}</p>
                    <p><span className="text-zinc-500">Wiki pages:</span> {blueprintUploadPreview.suggestedWikiPages.length}</p>
                    <p><span className="text-zinc-500">Próx. passos:</span> {blueprintUploadPreview.suggestedNextSteps.length}</p>
                    {blueprintUploadPreview.risks.length > 0 && (
                      <p className="text-amber-400">⚠ {blueprintUploadPreview.risks.join(' · ')}</p>
                    )}
                  </div>
                </div>
              )}

              {/* Import result */}
              {blueprintUploadResult && (
                <div className={`border rounded-lg px-4 py-3 space-y-1 ${blueprintUploadResult.ok ? 'bg-emerald-950/40 border-emerald-800' : 'bg-red-950/40 border-red-800'}`}>
                  <p className={`text-[11px] font-semibold ${blueprintUploadResult.ok ? 'text-emerald-400' : 'text-red-400'}`}>
                    {blueprintUploadResult.ok ? '✓ Blueprint importado!' : '✗ Erro ao importar'}
                  </p>
                  {blueprintUploadResult.ok && (
                    <div className="text-[11px] text-zinc-400 flex gap-3 flex-wrap">
                      {blueprintUploadResult.created.wikiPages.length > 0 && <span className="text-emerald-500">{blueprintUploadResult.created.wikiPages.length} wiki</span>}
                      {blueprintUploadResult.created.events.length > 0 && <span className="text-sky-400">{blueprintUploadResult.created.events.length} eventos</span>}
                      {blueprintUploadResult.created.nextSteps.length > 0 && <span className="text-violet-400">{blueprintUploadResult.created.nextSteps.length} próx. passos</span>}
                    </div>
                  )}
                  {blueprintUploadResult.warnings.length > 0 && (
                    <p className="text-amber-400 text-[10px]">{blueprintUploadResult.warnings.join(' · ')}</p>
                  )}
                </div>
              )}

              {/* Actions */}
              {blueprintUploadContent && !blueprintUploadResult && (
                <div className="flex gap-2">
                  <button
                    disabled={blueprintUploadLoading || !blueprintUploadTitle.trim()}
                    onClick={async () => {
                      if (!activeProjectId) return
                      setBlueprintUploadLoading(true)
                      try {
                        const res = await fetch(`${API_URL}/blueprint/preview`, {
                          method: 'POST',
                          headers: { ...authHeaders(), 'Content-Type': 'application/json' },
                          body: JSON.stringify({ projectId: activeProjectId, title: blueprintUploadTitle, content: blueprintUploadContent, format: 'markdown' }),
                        })
                        if (res.ok) setBlueprintUploadPreview(await res.json())
                      } finally {
                        setBlueprintUploadLoading(false)
                      }
                    }}
                    className="flex-1 text-xs px-3 py-2 rounded-lg border border-zinc-700 hover:border-emerald-500 hover:text-emerald-400 text-zinc-400 transition-colors disabled:opacity-40"
                  >
                    {blueprintUploadLoading ? 'Analisando...' : 'Preview'}
                  </button>
                  <button
                    disabled={blueprintUploadLoading || !blueprintUploadTitle.trim() || !activeProjectId}
                    onClick={async () => {
                      if (!activeProjectId) return
                      setBlueprintUploadLoading(true)
                      try {
                        const res = await fetch(`${API_URL}/blueprint/import`, {
                          method: 'POST',
                          headers: { ...authHeaders(), 'Content-Type': 'application/json' },
                          body: JSON.stringify({ projectId: activeProjectId, title: blueprintUploadTitle, content: blueprintUploadContent, format: 'markdown', source: 'manual' }),
                        })
                        if (res.ok) setBlueprintUploadResult(await res.json())
                      } finally {
                        setBlueprintUploadLoading(false)
                      }
                    }}
                    className="flex-1 text-xs px-3 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 text-white font-medium transition-colors disabled:opacity-40"
                  >
                    {blueprintUploadLoading ? 'Importando...' : 'Importar'}
                  </button>
                </div>
              )}

              {!activeProjectId && (
                <p className="text-amber-400 text-[11px] text-center">Selecione um projeto antes de importar.</p>
              )}
            </div>
          )}
          {blueprintTab === 'templates' && <>
            {/* Fluxo */}
            <div className="bg-zinc-800/50 rounded-lg px-4 py-3 text-xs text-zinc-400 leading-relaxed font-mono">
              Ideia bruta → ChatGPT/Claude <span className="text-zinc-600 mx-1">→</span> Blueprint Markdown <span className="text-zinc-600 mx-1">→</span> <span className="text-emerald-400">rayzen_blueprint_preview</span> <span className="text-zinc-600 mx-1">→</span> <span className="text-sky-400">rayzen_blueprint_import_markdown</span>
            </div>

            {/* Template completo */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-zinc-300 text-xs font-semibold uppercase tracking-wider">Prompt completo (14 seções)</span>
                <button
                  onClick={() => copy('full', PROMPT_FULL)}
                  className="text-xs px-3 py-1 rounded-md border border-zinc-700 hover:border-sky-500 hover:text-sky-400 text-zinc-400 transition-colors"
                >
                  {blueprintCopied === 'full' ? '✓ copiado' : 'copiar'}
                </button>
              </div>
              <pre className="bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-3 text-[11px] text-zinc-500 overflow-x-auto whitespace-pre-wrap leading-relaxed max-h-48 overflow-y-auto">
                {PROMPT_FULL}
              </pre>
            </div>

            {/* Template curto */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-zinc-300 text-xs font-semibold uppercase tracking-wider">Prompt curto (uso diário)</span>
                <button
                  onClick={() => copy('short', PROMPT_SHORT)}
                  className="text-xs px-3 py-1 rounded-md border border-zinc-700 hover:border-sky-500 hover:text-sky-400 text-zinc-400 transition-colors"
                >
                  {blueprintCopied === 'short' ? '✓ copiado' : 'copiar'}
                </button>
              </div>
              <pre className="bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-3 text-[11px] text-zinc-500 overflow-x-auto whitespace-pre-wrap leading-relaxed max-h-32 overflow-y-auto">
                {PROMPT_SHORT}
              </pre>
            </div>

            {/* O que o parser detecta */}
            <div>
              <span className="text-zinc-300 text-xs font-semibold uppercase tracking-wider block mb-2">O que o parser detecta</span>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
                {[
                  ['- Implementar / Criar / Adicionar ...', 'nextSteps + backlog'],
                  ['- Decidimos / Optamos / Aprovado ...', 'evento decision'],
                  ['- Problema: / Blocker: / Issue: ...', 'evento problem'],
                  ['## Seção / ### Subseção', 'página Wiki separada'],
                ].map(([pattern, result]) => (
                  <div key={pattern} className="flex gap-2 items-start">
                    <span className="text-zinc-600 font-mono shrink-0">{pattern}</span>
                    <span className="text-zinc-500">→ {result}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Comando Claude Code */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-zinc-300 text-xs font-semibold uppercase tracking-wider">Comando para o Claude Code</span>
                <button
                  onClick={() => copy('cmd', 'Use rayzen_blueprint_preview com este Markdown e me mostre o que será criado antes de importar.\n\ntitle: "[TÍTULO]"\nmarkdown: """\n[MARKDOWN AQUI]\n"""')}
                  className="text-xs px-3 py-1 rounded-md border border-zinc-700 hover:border-sky-500 hover:text-sky-400 text-zinc-400 transition-colors"
                >
                  {blueprintCopied === 'cmd' ? '✓ copiado' : 'copiar'}
                </button>
              </div>
              <pre className="bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-3 text-[11px] text-zinc-500 whitespace-pre-wrap leading-relaxed">
{`Use rayzen_blueprint_preview com este Markdown e me mostre o que será criado antes de importar.

title: "[TÍTULO]"
markdown: """
[MARKDOWN AQUI]
"""

→ Se correto: Use rayzen_blueprint_import_markdown para importar.`}
              </pre>
            </div>
          </>}
          </div>
        </div>
      </div>
    </>
  )
}
