'use client'

import type { Dispatch, SetStateAction } from 'react'
import { API_URL } from '../../lib/api-url'
import { authHeaders } from '../../lib/api-client'
import type { MemoryDoc, MemorySearchResult } from '../hooks/useMemory'
import type { Project } from '../hooks/useProjects'
import type { MemoryDocType } from '../page'
import { DOC_TYPE_COLORS, DOC_TYPE_LABELS, PROJECT_COLORS, memoryGroupFor, memoryDocType, projectLabelFromPath, relativePathFromFull } from '../page'
import { HelpTip } from './HelpTip'

interface MemoryPanelProps {
  activeProjectId: string | null
  projects: Project[]
  memoryDocsLoading: boolean
  memoryDocs: MemoryDoc[]
  setMemoryDocs: Dispatch<SetStateAction<MemoryDoc[]>>
  memorySearch: string
  setMemorySearch: (value: string) => void
  handleMemorySearch: () => void
  memorySearching: boolean
  memorySearchResults: MemorySearchResult[] | null
  setMemorySearchResults: Dispatch<SetStateAction<MemorySearchResult[] | null>>
  memoryListFilter: string
  setMemoryListFilter: (value: string) => void
  onClose: () => void
}

export function MemoryPanel({
  activeProjectId, projects, memoryDocsLoading, memoryDocs, setMemoryDocs,
  memorySearch, setMemorySearch, handleMemorySearch, memorySearching,
  memorySearchResults, setMemorySearchResults, memoryListFilter, setMemoryListFilter, onClose,
}: MemoryPanelProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/70" onClick={onClose} />
      <div className="relative z-50 w-full max-w-lg bg-zinc-900 border border-zinc-800 rounded-2xl p-6 mx-4 flex flex-col max-h-[80vh]">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-sm font-semibold text-zinc-200 flex items-center gap-1.5">
              {activeProjectId ? `Memória — ${projects.find(p => p.id === activeProjectId)?.name ?? 'Projeto'}` : 'Memória indexada'}
              <HelpTip title="Brain / Memória" side="bottom">
                Documentos indexados com embeddings (pgvector). A busca semântica alimenta o Context Broker.<br /><br />
                <strong>Classes:</strong> inbox → working → consolidated → archive.<br />
                <strong>Indexar mais fontes:</strong> use o botão &quot;Indexar no Brain&quot; ou importe pelo wizard de projeto.
              </HelpTip>
            </h2>
            {!memoryDocsLoading && (
              <p className="text-xs text-zinc-500 mt-0.5">
                {memoryDocs.length} chunks
                {!activeProjectId && ' · todos os projetos'}
              </p>
            )}
          </div>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 text-xl leading-none">×</button>
        </div>

        {/* Search */}
        <div className="flex gap-2 mb-4">
          <input
            value={memorySearch}
            onChange={(e) => setMemorySearch(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleMemorySearch() }}
            placeholder="Buscar na memória…"
            className="flex-1 bg-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 outline-none focus:ring-1 focus:ring-zinc-600"
          />
          <button
            onClick={handleMemorySearch}
            disabled={memorySearching || !memorySearch.trim()}
            className="bg-zinc-700 hover:bg-zinc-600 text-zinc-200 rounded-lg px-3 py-2 text-xs font-medium disabled:opacity-40 transition-colors"
          >
            {memorySearching ? '…' : 'Buscar'}
          </button>
          {memorySearchResults !== null && (
            <button
              onClick={() => { setMemorySearch(''); setMemorySearchResults(null) }}
              className="text-zinc-500 hover:text-zinc-300 text-xs px-2"
            >limpar</button>
          )}
        </div>

        {/* List filter */}
        {memorySearchResults === null && (
          <div className="mb-4">
            <input
              value={memoryListFilter}
              onChange={(e) => setMemoryListFilter(e.target.value)}
              placeholder="Filtrar origens indexadas..."
              className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-zinc-100 placeholder:text-zinc-600 outline-none focus:ring-1 focus:ring-zinc-600"
            />
          </div>
        )}

        {/* Results */}
        <div className="overflow-y-auto flex-1 space-y-2 pr-1">
          {memoryDocsLoading && <p className="text-xs text-zinc-500 text-center py-8">Carregando…</p>}

          {/* Search results */}
          {memorySearchResults !== null && !memorySearching && (
            <>
              {memorySearchResults.length === 0 && (
                <p className="text-xs text-zinc-500 text-center py-8">Nenhum resultado encontrado</p>
              )}
              {memorySearchResults.map((r) => {
                const dtype = memoryDocType(r.sourcePath, null)
                const fileName = r.sourcePath ? r.sourcePath.split('/').pop() ?? r.sourcePath : 'sem origem'
                return (
                  <div key={r.id} className="bg-zinc-800 rounded-xl p-3">
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className={`shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded-md ${DOC_TYPE_COLORS[dtype]}`}>
                          {DOC_TYPE_LABELS[dtype]}
                        </span>
                        <span className="text-[11px] text-zinc-500 truncate" title={r.sourcePath ?? ''}>{fileName}</span>
                      </div>
                      <span className="text-[11px] text-zinc-600 ml-2 shrink-0">{(r.score * 100).toFixed(0)}%</span>
                    </div>
                    <p className="text-xs text-zinc-300 line-clamp-3">{r.content}</p>
                  </div>
                )
              })}
            </>
          )}

          {/* Document list */}
          {memorySearchResults === null && !memoryDocsLoading && (() => {
            const projectColorMap = new Map<string, string>()
            projects.forEach((p, i) => projectColorMap.set(p.id, PROJECT_COLORS[i % PROJECT_COLORS.length]))

            const groups = memoryDocs.reduce<Record<string, {
              ids: string[]; count: number; label: string; lastIndexedAt: string
              docType: MemoryDocType; projectId: string | null; sourcePath: string | null
            }>>((acc, d) => {
              const group = memoryGroupFor(d)
              const key = group.key
              const indexedAt = d.createdAt
              if (!acc[key]) acc[key] = {
                ids: [], count: 0, label: group.label, lastIndexedAt: indexedAt,
                docType: memoryDocType(d.sourcePath, d.metadata),
                projectId: d.projectId ?? null,
                sourcePath: d.sourcePath,
              }
              acc[key].ids.push(d.id)
              acc[key].count++
              if (new Date(indexedAt).getTime() > new Date(acc[key].lastIndexedAt).getTime()) {
                acc[key].lastIndexedAt = indexedAt
              }
              return acc
            }, {})

            const filter = memoryListFilter.trim().toLowerCase()
            const entries = Object.entries(groups)
              .filter(([source, group]) => !filter || source.toLowerCase().includes(filter) || group.label.toLowerCase().includes(filter))
              .sort((a, b) => new Date(b[1].lastIndexedAt).getTime() - new Date(a[1].lastIndexedAt).getTime())

            if (entries.length === 0) {
              return <p className="text-xs text-zinc-500 text-center py-8">Nenhuma origem encontrada</p>
            }

            return entries.map(([source, { ids, count, label, lastIndexedAt, docType, projectId, sourcePath }]) => {
              const project = projectId ? projects.find(p => p.id === projectId) : null
              const projectColor = projectId ? (projectColorMap.get(projectId) ?? PROJECT_COLORS[0]) : null
              const norm = (sourcePath ?? '').replace(/\\/g, '/')
              const fileName = norm ? (norm.split('/').pop() ?? label) : label
              const inferredProject = !project ? projectLabelFromPath(sourcePath) : null
              const relDir = relativePathFromFull(sourcePath)
              const displayPath = relDir ?? (norm.length > 60 ? '…' + norm.slice(-55) : norm)

              return (
                <div key={source} className="bg-zinc-800 rounded-xl px-3 py-2.5 group">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      {/* Linha 1: badges tipo + projeto */}
                      <div className="flex items-center gap-1.5 mb-1.5 flex-wrap">
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${DOC_TYPE_COLORS[docType]}`}>
                          {DOC_TYPE_LABELS[docType]}
                        </span>
                        {project ? (
                          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${projectColor}`}>
                            {project.name}
                          </span>
                        ) : inferredProject ? (
                          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-zinc-600/50 text-zinc-300">
                            {inferredProject}
                          </span>
                        ) : null}
                      </div>
                      {/* Linha 2: nome do arquivo em destaque */}
                      <span className="block text-sm text-zinc-100 font-semibold truncate" title={sourcePath ?? label}>
                        {fileName}
                      </span>
                      {/* Linha 3: caminho relativo */}
                      <span className="block text-[11px] text-zinc-500 truncate mt-0.5" title={norm || source}>
                        {displayPath}
                      </span>
                      {/* Linha 4: timestamp */}
                      <span className="block text-[10px] text-zinc-600 mt-0.5">
                        {new Date(lastIndexedAt).toLocaleString('pt-BR')}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0 mt-0.5">
                      <span className="text-[11px] text-zinc-500">{count} chunk{count !== 1 ? 's' : ''}</span>
                      <button
                        onClick={async () => {
                          if (!confirm(`Deletar todos os ${count} chunks de "${source}"?`)) return
                          await Promise.all(ids.map(id =>
                            fetch(`${API_URL}/memory/documents/${id}`, { method: 'DELETE', headers: authHeaders() })
                          ))
                          setMemoryDocs(prev => prev.filter(d => !ids.includes(d.id)))
                        }}
                        className="opacity-0 group-hover:opacity-100 text-zinc-600 hover:text-red-400 transition-all"
                        title="Deletar todos os chunks desta origem"
                      >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <polyline points="3 6 5 6 21 6"/>
                          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                          <path d="M10 11v6M14 11v6"/>
                          <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
                        </svg>
                      </button>
                    </div>
                  </div>
                </div>
              )
            })
          })()}
        </div>
      </div>
    </div>
  )
}
