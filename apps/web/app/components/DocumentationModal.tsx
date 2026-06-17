'use client'

import ReactMarkdown from 'react-markdown'
import type { ProjectDoc } from '../page'

interface SyncResult { synced: number; conflicts: Array<{ type: string; vaultModifiedAt: string }> }
interface NotionSyncResult { synced: Array<{ type: string; url: string; status: string }>; skipped: string[]; projectPageId: string }

interface DocumentationModalProps {
  projectDocs: ProjectDoc[]
  docsLoading: boolean
  activeDocType: string
  onActiveDocTypeChange: (type: string) => void
  generatingDocs: boolean
  onGenerateAll: () => void
  syncing: boolean
  onSyncObsidian: (force: boolean) => void
  notionSyncing: boolean
  onSyncNotion: () => void
  activeProjectId: string | null
  syncResult: SyncResult | null
  notionSyncResult: NotionSyncResult | null
  onDismissNotionResult: () => void
  onOpenVersions: (type: string) => void
  onClose: () => void
}

const DOC_TABS = [
  { type: 'project_state', label: 'Estado do projeto' },
  { type: 'decisions_log', label: 'Decisões' },
  { type: 'next_actions', label: 'Próximas ações' },
  { type: 'work_journal', label: 'Diário' },
  { type: 'test_evidence', label: 'Evidencias de teste' },
]

export function DocumentationModal({
  projectDocs, docsLoading, activeDocType, onActiveDocTypeChange,
  generatingDocs, onGenerateAll, syncing, onSyncObsidian, notionSyncing, onSyncNotion,
  activeProjectId, syncResult, notionSyncResult, onDismissNotionResult, onOpenVersions, onClose,
}: DocumentationModalProps) {
  const activeDoc = projectDocs.find(d => d.type === activeDocType)
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/70" onClick={onClose} />
      <div className="relative z-50 w-full max-w-3xl bg-zinc-900 border border-zinc-800 rounded-2xl mx-4 max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
          <h2 className="text-sm font-semibold">Documentação viva</h2>
          <div className="flex items-center gap-2">
            <button
              onClick={onGenerateAll}
              disabled={generatingDocs}
              className="text-xs bg-zinc-700 hover:bg-zinc-600 disabled:opacity-40 text-zinc-200 px-3 py-1.5 rounded-lg transition-colors"
            >
              {generatingDocs ? 'Gerando…' : 'Regenerar'}
            </button>
            <button
              onClick={() => onSyncObsidian(false)}
              disabled={syncing}
              className="text-xs bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white px-3 py-1.5 rounded-lg transition-colors"
            >
              {syncing ? 'Sincronizando…' : '⬡ Obsidian'}
            </button>
            <button
              onClick={onSyncNotion}
              disabled={notionSyncing || !activeProjectId}
              className="text-xs bg-orange-700 hover:bg-orange-600 disabled:opacity-40 text-white px-3 py-1.5 rounded-lg transition-colors"
              title="Publicar documentação no Notion"
            >
              {notionSyncing ? 'Publicando…' : 'N Notion'}
            </button>
            <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 text-xs">fechar</button>
          </div>
        </div>
        {/* Notion sync result */}
        {notionSyncResult && (
          <div className="px-6 py-3 text-xs border-b border-zinc-800 bg-orange-950/30">
            <div className="flex items-start justify-between gap-2">
              <div className="space-y-1">
                {notionSyncResult.synced.length > 0 ? (
                  <>
                    <p className="text-orange-300 font-medium">{notionSyncResult.synced.length} doc(s) publicado(s) no Notion</p>
                    {notionSyncResult.synced.map(s => (
                      <div key={s.type} className="flex items-center gap-2">
                        <span className={`text-[10px] px-1.5 py-0.5 rounded ${s.status === 'created' ? 'bg-emerald-900/50 text-emerald-400' : 'bg-zinc-700 text-zinc-400'}`}>{s.status}</span>
                        <span className="text-zinc-400">{s.type}</span>
                        <a href={s.url} target="_blank" rel="noreferrer" className="text-orange-400 hover:text-orange-300 underline text-[10px]">abrir ↗</a>
                      </div>
                    ))}
                  </>
                ) : (
                  <p className="text-zinc-500">Nenhum documento sincronizado. Gere a documentação primeiro.</p>
                )}
                {notionSyncResult.skipped.length > 0 && (
                  <p className="text-amber-400 mt-1">Ignorados: {notionSyncResult.skipped.join(', ')}</p>
                )}
              </div>
              <button onClick={onDismissNotionResult} className="text-zinc-600 hover:text-zinc-400 shrink-0">×</button>
            </div>
          </div>
        )}
        {/* Sync result / conflicts */}
        {syncResult && (
          <div className={`px-6 py-3 text-xs border-b border-zinc-800 ${syncResult.conflicts.length > 0 ? 'bg-amber-950/40' : 'bg-emerald-950/40'}`}>
            {syncResult.conflicts.length === 0 ? (
              <span className="text-emerald-400">{syncResult.synced} arquivo(s) sincronizado(s) com sucesso.</span>
            ) : (
              <div className="space-y-1">
                <p className="text-amber-400 font-medium">{syncResult.conflicts.length} conflito(s) detectado(s) — vault foi editado após a última geração:</p>
                {syncResult.conflicts.map(c => (
                  <div key={c.type} className="flex items-center justify-between">
                    <span className="text-zinc-400">{c.type} · editado em {new Date(c.vaultModifiedAt).toLocaleString('pt-BR')}</span>
                    <button
                      onClick={() => onSyncObsidian(true)}
                      className="text-amber-400 hover:text-amber-300 underline ml-2"
                    >
                      sobrescrever
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        {/* Tabs */}
        <div className="flex gap-1 px-6 pt-4 pb-0">
          {DOC_TABS.map(tab => (
            <button
              key={tab.type}
              onClick={() => onActiveDocTypeChange(tab.type)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${activeDocType === tab.type ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'}`}
            >
              {tab.label}
              {projectDocs.find(d => d.type === tab.type)?.reviewedAt && (
                <span className="ml-1 text-emerald-500">✓</span>
              )}
            </button>
          ))}
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {docsLoading && <p className="text-zinc-500 text-xs text-center py-8">Carregando…</p>}
          {!docsLoading && !activeDoc && (
            <div className="text-center py-8">
              <p className="text-zinc-500 text-xs mb-3">Documento não gerado ainda.</p>
              <button
                onClick={onGenerateAll}
                disabled={generatingDocs}
                className="text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-300 px-4 py-2 rounded-lg transition-colors disabled:opacity-40"
              >
                {generatingDocs ? 'Gerando…' : 'Gerar agora'}
              </button>
            </div>
          )}
          {!docsLoading && activeDoc && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <span className="text-[10px] text-zinc-600">
                  Gerado em {new Date(activeDoc.generatedAt).toLocaleString('pt-BR')}
                  {activeDoc.reviewedAt && ` · revisado ${new Date(activeDoc.reviewedAt).toLocaleString('pt-BR')}`}
                </span>
                <button
                  onClick={() => onOpenVersions(activeDocType)}
                  className="text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors underline"
                >
                  ver histórico
                </button>
              </div>
              <div className="prose prose-invert prose-sm max-w-none">
                <ReactMarkdown>{activeDoc.content}</ReactMarkdown>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
