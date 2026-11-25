'use client'

import { useEffect, useState } from 'react'
import { API_URL } from '../../lib/api-url'
import { authHeaders } from '../../lib/api-client'

/**
 * Visualizador de um caminho citado no chat — item 3 (12/11).
 *
 * Abre o arquivo REAL do checkout do projeto, lido pelo agent desktop. O caso que motivou: o Hub
 * citou `docs/ARCHITECTURE.md` "adicionado por mim" num repositório onde ele não existe. Clicar
 * agora mostra "não existe no repositório" — a citação inventada fica visível na hora.
 */

type Leitura =
  | { estado: 'carregando' }
  | { estado: 'conteudo'; conteudo: string; truncado: boolean; bytes?: number }
  | { estado: 'lista'; arquivos: Array<{ path: string; naoCommitado?: boolean; segredo?: boolean }>; total: number; truncado: boolean }
  | { estado: 'aviso'; titulo: string; texto: string; tom: 'ambar' | 'vermelho' | 'neutro' }

/** Texto de `code` inline que parece caminho RELATIVO de arquivo/pasta do projeto. */
export function pareceCaminhoDoProjeto(texto: string): boolean {
  const t = texto.trim()
  if (!t || t.length > 200 || /\s/.test(t)) return false
  if (/^[a-z]+:\/\//i.test(t) || /^[a-z]:/i.test(t) || t.startsWith('/') || t.startsWith('~')) return false
  if (t.includes('..')) return false
  if (!/^[\w@.\-/]+$/.test(t)) return false
  // Arquivo com extensão (`src/a.ts`, `.gitignore`, `README.md`) ou pasta explícita (`src/`).
  return /\.[A-Za-z0-9]+$/.test(t) || t.endsWith('/')
}

export function ArquivoDoProjetoModal({ projectId, caminho, onClose }: { projectId: string; caminho: string; onClose: () => void }) {
  const [leitura, setLeitura] = useState<Leitura>({ estado: 'carregando' })
  const ehPasta = caminho.endsWith('/')

  useEffect(() => {
    let vivo = true
    const rota = ehPasta
      ? `${API_URL}/projects/${encodeURIComponent(projectId)}/files?path=${encodeURIComponent(caminho.replace(/\/$/, ''))}`
      : `${API_URL}/projects/${encodeURIComponent(projectId)}/files/content?path=${encodeURIComponent(caminho)}`
    fetch(rota, { headers: authHeaders() })
      .then(async (r) => {
        const corpo = await r.json().catch(() => ({})) as Record<string, unknown>
        if (!vivo) return
        if (r.status === 503) return setLeitura({ estado: 'aviso', tom: 'ambar', titulo: 'Agent offline', texto: 'O agent da máquina onde o projeto está não respondeu. Nada foi lido — ligue o PC/agent e tente de novo.' })
        if (r.status === 409) return setLeitura({ estado: 'aviso', tom: 'ambar', titulo: 'Checkout indisponível', texto: String(corpo.message ?? 'O projeto não tem checkout nesta máquina.') })
        if (r.status === 400) return setLeitura({ estado: 'aviso', tom: 'vermelho', titulo: 'Caminho recusado', texto: 'O caminho sai da pasta do projeto.' })
        if (!r.ok) return setLeitura({ estado: 'aviso', tom: 'vermelho', titulo: `Erro ${r.status}`, texto: String(corpo.message ?? 'Não foi possível ler.') })
        if (ehPasta) {
          return setLeitura({
            estado: 'lista',
            arquivos: (corpo.arquivos as Array<{ path: string }>) ?? [],
            total: Number(corpo.total ?? 0),
            truncado: Boolean(corpo.truncado),
          })
        }
        if (corpo.existe === false) {
          return setLeitura({ estado: 'aviso', tom: 'vermelho', titulo: 'Não existe no repositório', texto: `"${caminho}" não está no checkout do projeto. Se a resposta o citou, a citação não corresponde ao que existe.` })
        }
        if (corpo.recusado === 'segredo') return setLeitura({ estado: 'aviso', tom: 'neutro', titulo: 'Arquivo de segredo', texto: 'O arquivo existe, mas o conteúdo de segredos (.env, chaves) nunca é exibido.' })
        if (corpo.diretorio) return setLeitura({ estado: 'aviso', tom: 'neutro', titulo: 'É uma pasta', texto: `Clique em "${caminho}/" para listar.` })
        if (corpo.binario) return setLeitura({ estado: 'aviso', tom: 'neutro', titulo: 'Arquivo binário', texto: `${corpo.bytes ?? '?'} bytes — sem visualização de texto.` })
        setLeitura({ estado: 'conteudo', conteudo: String(corpo.conteudo ?? ''), truncado: Boolean(corpo.truncado), bytes: Number(corpo.bytes ?? 0) })
      })
      .catch(() => { if (vivo) setLeitura({ estado: 'aviso', tom: 'vermelho', titulo: 'Sem conexão', texto: 'A API não respondeu.' }) })
    return () => { vivo = false }
  }, [projectId, caminho, ehPasta])

  // Um tom por linha: cada fundo leva o texto da própria família de cor.
  const cor = {
    ambar: 'border-amber-900/60 bg-amber-950/20 text-amber-200',
    vermelho: 'border-red-900/60 bg-red-950/20 text-red-200',
    neutro: 'border-zinc-700 bg-zinc-800/60 text-zinc-100',
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/70" onClick={onClose} />
      <div className="relative z-50 mx-4 flex max-h-[85vh] w-full max-w-3xl flex-col rounded-2xl border border-zinc-800 bg-zinc-900">
        <div className="flex items-center justify-between gap-3 border-b border-zinc-800 px-4 py-3">
          <div className="min-w-0">
            <p className="truncate font-mono text-sm text-zinc-200">{caminho}</p>
            <p className="text-[11px] text-zinc-500">lido agora do checkout do projeto, pelo agent</p>
          </div>
          <button onClick={onClose} className="text-xs text-zinc-500">fechar</button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-4">
          {leitura.estado === 'carregando' && <p className="text-xs text-zinc-500">Lendo…</p>}
          {leitura.estado === 'aviso' && (
            <div className={`rounded-xl border p-4 ${cor[leitura.tom]}`}>
              <p className="text-sm font-medium">{leitura.titulo}</p>
              <p className="mt-1 text-xs opacity-90">{leitura.texto}</p>
            </div>
          )}
          {leitura.estado === 'conteudo' && (
            <>
              <pre className="whitespace-pre-wrap wrap-break-word font-mono text-xs leading-relaxed text-zinc-200">{leitura.conteudo}</pre>
              {leitura.truncado && <p className="mt-3 text-[11px] text-amber-400">Mostrando os primeiros 200 KB de {leitura.bytes} bytes.</p>}
            </>
          )}
          {leitura.estado === 'lista' && (
            <ul className="space-y-1 font-mono text-xs text-zinc-300">
              {leitura.arquivos.length === 0 && <li className="text-zinc-500">Nenhum arquivo nesta pasta.</li>}
              {leitura.arquivos.map((a) => (
                <li key={a.path} className="flex gap-2">
                  <span>{a.path}</span>
                  {a.naoCommitado && <span className="text-amber-400">· sem commit</span>}
                  {a.segredo && <span className="text-zinc-500">· segredo</span>}
                </li>
              ))}
              {leitura.truncado && <li className="text-amber-400">… e mais ({leitura.total} no total)</li>}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
