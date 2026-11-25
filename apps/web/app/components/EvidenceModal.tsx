'use client'

import { useEffect, useState } from 'react'
import { API_URL } from '../../lib/api-url'
import { authHeaders } from '../../lib/api-client'
import type { EvidenceItem } from '../page'

export type EvidenceFilter = 'all' | 'with_run' | 'without_run'

/**
 * Busca o arquivo COM autenticação e exibe via blob.
 *
 * `GET /evidence/file/:projectId/:fileName` exige `Authorization`, e um `<img src>` não
 * manda header nenhum — então a tag apontada direto para a API devolvia **401 para toda
 * evidência, sempre**. Medido em 2026-08-20: o arquivo respondia `200 image/png` com
 * token e `401` sem, o que fazia a única evidência do acervo parecer perdida quando
 * estava no disco.
 *
 * A alternativa seria abrir o endpoint ou aceitar token na query. A primeira troca
 * autenticação por URL difícil de adivinhar; a segunda põe o JWT em log de acesso e
 * histórico do navegador. Buscar com header e converter em blob não mexe no contrato.
 */
/** Abre a evidência em aba nova, buscando com token — ver o comentário de `EvidenceImage`. */
async function abrirEvidencia(remotePath: string) {
  try {
    const res = await fetch(`${API_URL}/evidence/file/${remotePath.replace(/\\/g, '/')}`, { headers: authHeaders() })
    if (!res.ok) { alert(res.status === 404 ? 'Arquivo não encontrado no servidor.' : `Falha ao abrir (HTTP ${res.status}).`); return }
    const url = URL.createObjectURL(await res.blob())
    window.open(url, '_blank', 'noopener,noreferrer')
    // A aba nova já carregou o blob; sem isto a URL fica presa até a página recarregar.
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
  } catch { alert('Falha ao abrir a evidência.') }
}

function EvidenceImage({ remotePath, alt }: { remotePath: string; alt: string }) {
  const [url, setUrl]     = useState<string | null>(null)
  const [erro, setErro]   = useState<'ausente' | 'falhou' | null>(null)

  useEffect(() => {
    let vivo = true
    let objectUrl: string | null = null

    void (async () => {
      try {
        const res = await fetch(`${API_URL}/evidence/file/${remotePath.replace(/\\/g, '/')}`, { headers: authHeaders() })
        if (!res.ok) { if (vivo) setErro(res.status === 404 ? 'ausente' : 'falhou'); return }
        objectUrl = URL.createObjectURL(await res.blob())
        if (vivo) setUrl(objectUrl)
        else URL.revokeObjectURL(objectUrl)   // desmontou durante o fetch
      } catch { if (vivo) setErro('falhou') }
    })()

    return () => { vivo = false; if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [remotePath])

  if (erro) {
    return (
      <div className="h-48 flex flex-col items-center justify-center gap-1 border-b border-zinc-800 bg-zinc-900/60 px-4 text-center">
        <span className="text-xs text-amber-400">
          {erro === 'ausente' ? 'arquivo não encontrado no servidor' : 'não foi possível carregar a imagem'}
        </span>
        <span className="text-[10px] text-zinc-500">
          {erro === 'ausente'
            ? 'o registro existe, a imagem se perdeu — "excluir" remove a linha órfã'
            : 'o registro existe; tente "atualizar"'}
        </span>
      </div>
    )
  }

  if (!url) return <div className="h-48 border-b border-zinc-800 bg-zinc-900/40 animate-pulse" />

  // eslint-disable-next-line @next/next/no-img-element -- blob local já autenticado; o otimizador do next/image não se aplica
  return <img src={url} alt={alt} className="w-full h-48 object-cover border-b border-zinc-800" />
}

interface EvidenceModalProps {
  evidenceItems: EvidenceItem[]
  evidenceLoading: boolean
  evidenceFilter: EvidenceFilter
  deletingEvidenceId: string | null
  evidenceUploading: boolean
  onUpload: (e: React.ChangeEvent<HTMLInputElement>) => void
  onFilterChange: (filter: EvidenceFilter) => void
  onRefresh: () => void
  onDelete: (id: string) => void
  onClose: () => void
}

export function EvidenceModal({
  evidenceItems, evidenceLoading, evidenceFilter, deletingEvidenceId, evidenceUploading,
  onUpload, onFilterChange, onRefresh, onDelete, onClose,
}: EvidenceModalProps) {
  return (
    <div className="fixed inset-0 z-[55] flex items-center justify-center">
      <div className="fixed inset-0 bg-black/80" onClick={onClose} />
      <div className="relative z-[55] w-full max-w-4xl bg-zinc-900 border border-zinc-800 rounded-2xl mx-4 max-h-[88vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
          <div>
            <h2 className="text-sm font-semibold">Evidencias</h2>
            <p className="text-xs text-zinc-500">Capturas visuais associadas ao projeto ativo.</p>
          </div>
          <div className="flex items-center gap-2">
            {(['all', 'with_run', 'without_run'] as const).map(filter => (
              <button
                key={filter}
                onClick={() => onFilterChange(filter)}
                className={`text-[10px] px-2 py-1 rounded-lg transition-colors ${evidenceFilter === filter ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'}`}
              >
                {filter === 'all' ? 'todas' : filter === 'with_run' ? 'com TestRun' : 'sem TestRun'}
              </button>
            ))}
            {/* Até 2026-08-20 não havia caminho de upload na interface: o único produtor
                era `jarvis:screenshot` no poller do agent, e em 3 meses o acervo tinha
                1 registro. O backend (`POST /evidence/upload/:projectId`) já estava pronto. */}
            <label className={`text-[10px] px-2 py-1 rounded-lg transition-colors ${evidenceUploading ? 'bg-zinc-800 text-zinc-300 cursor-wait' : 'bg-cyan-900/60 text-cyan-300 hover:bg-cyan-900 cursor-pointer'}`}>
              {evidenceUploading ? 'enviando…' : '+ enviar print'}
              <input
                type="file"
                multiple
                accept="image/png,image/jpeg,image/webp,image/gif"
                className="hidden"
                disabled={evidenceUploading}
                onChange={onUpload}
              />
            </label>
            <button onClick={onRefresh} className="text-zinc-500 hover:text-zinc-300 text-xs">atualizar</button>
            <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 text-xs">fechar</button>
          </div>
        </div>
        <div className="p-6 overflow-y-auto">
          {evidenceLoading && <p className="text-zinc-500 text-xs text-center py-10">Carregando...</p>}
          {!evidenceLoading && evidenceItems.length === 0 && (
            <p className="text-zinc-500 text-xs text-center py-10">Nenhuma evidencia registrada ainda.</p>
          )}
          {!evidenceLoading && evidenceItems.length > 0 && (() => {
            const filtered = evidenceItems.filter(item =>
              evidenceFilter === 'all' ? true : evidenceFilter === 'with_run' ? Boolean(item.testRunId) : !item.testRunId,
            )
            const grouped = filtered.reduce<Record<string, EvidenceItem[]>>((acc, item) => {
              const key = item.testRunId ? `TestRun ${item.testRunId.slice(0, 8)}` : 'Sem TestRun vinculado'
              acc[key] = [...(acc[key] ?? []), item]
              return acc
            }, {})
            const entries = Object.entries(grouped)
            return entries.length === 0 ? (
              <p className="text-zinc-500 text-xs text-center py-10">Nenhuma evidencia neste filtro.</p>
            ) : (
              <div className="space-y-6">
                {entries.map(([group, items]) => (
                  <section key={group} className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="text-xs font-semibold text-zinc-400">{group}</h3>
                      <span className="text-[10px] text-zinc-600">{items.length} evidencia{items.length !== 1 ? 's' : ''}</span>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      {items.map((item) => (
                        <div key={item.id} className="rounded-xl border border-zinc-800 bg-zinc-950/60 overflow-hidden">
                          {item.remotePath ? (
                            <EvidenceImage
                              remotePath={item.remotePath}
                              alt={item.prompt ? `Evidencia: ${item.prompt}` : 'Screenshot do projeto'}
                            />
                          ) : (
                            <div className="h-48 flex items-center justify-center text-xs text-zinc-600 border-b border-zinc-800">
                              arquivo local ainda não sincronizado
                            </div>
                          )}
                          <div className="p-3 space-y-2">
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-1.5">
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-900 text-cyan-300">screenshot</span>
                                {item.category && item.category !== 'general' && (
                                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300">
                                    {item.category}
                                  </span>
                                )}
                                {item.testRunId && (
                                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-900 text-emerald-300" title={item.testRunId}>
                                    test run {item.testRunId.slice(0, 8)}
                                  </span>
                                )}
                              </div>
                              <span className="text-[10px] text-zinc-600">
                                {new Date(item.takenAt ?? item.createdAt).toLocaleString('pt-BR')}
                              </span>
                            </div>
                            {item.description
                              ? <p className="text-xs text-zinc-200 line-clamp-2">{item.description}</p>
                              : item.prompt && <p className="text-xs text-zinc-300 line-clamp-2">{item.prompt}</p>}
                            {item.localPath && (
                              <p className="text-[10px] font-mono text-zinc-600 truncate" title={item.localPath}>{item.localPath}</p>
                            )}
                            <div className="flex items-center justify-end gap-2 pt-1">
                              {item.remotePath && (
                                // Botão e não <a href>: abrir a URL da API numa aba nova vai sem
                                // `Authorization` e cai em 401, o mesmo motivo que impedia o <img>
                                // de renderizar. Busca autenticada e abre o blob.
                                <button
                                  onClick={() => void abrirEvidencia(item.remotePath!)}
                                  className="text-[10px] text-cyan-400 hover:text-cyan-300"
                                >
                                  abrir
                                </button>
                              )}
                              <button
                                onClick={() => onDelete(item.id)}
                                disabled={deletingEvidenceId === item.id}
                                className="text-[10px] text-red-400 hover:text-red-300 disabled:opacity-40"
                              >
                                {deletingEvidenceId === item.id ? 'excluindo...' : 'excluir'}
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            )
          })()}
        </div>
      </div>
    </div>
  )
}
