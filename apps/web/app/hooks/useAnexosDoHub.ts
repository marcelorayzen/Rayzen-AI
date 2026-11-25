'use client'

import { useCallback, useState } from 'react'
import { API_URL } from '../../lib/api-url'
import { authHeaders } from '../../lib/api-client'

/**
 * HC3 (21/11/2026) — anexos do compositor do Hub. Cada arquivo sobe para `/hub/anexos` assim que
 * entra (clipe, colar print, arrastar, câmera); o turno leva só os ids prontos. O servidor decide
 * tipo, tamanho e o texto que o modelo verá — aqui só há a fila visível para a pessoa.
 */
export interface AnexoNoCompositor {
  idLocal: string
  nome: string
  tamanho: number
  estado: 'enviando' | 'pronto' | 'erro'
  /** id no servidor, quando pronto */
  id?: string
  /** o que o servidor extraiu: para a pessoa ver o que o modelo vai receber */
  previa?: string
  truncado?: boolean
  caracteres?: number
  erro?: string
}

export const TETO_ANEXOS_NO_TURNO = 3

const MENSAGENS_DE_ERRO: Record<string, string> = {
  hub_anexo_tipo: 'tipo não aceito (PDF, imagem, .txt, .md, .csv, .json)',
  hub_anexo_grande: 'arquivo acima de 10 MB',
  hub_anexo_vazio: 'arquivo vazio',
  hub_anexo_pdf_ilegivel: 'PDF ilegível',
  hub_anexo_visao_indisponivel: 'o leitor de imagem está sem cota ou sobrecarregado — tente mais tarde',
}

export function useAnexosDoHub() {
  const [anexos, setAnexos] = useState<AnexoNoCompositor[]>([])

  const atualizar = (idLocal: string, mudanca: Partial<AnexoNoCompositor>) =>
    setAnexos((lista) => lista.map((a) => (a.idLocal === idLocal ? { ...a, ...mudanca } : a)))

  const enviarUm = useCallback(async (arquivo: File, idLocal: string) => {
    const corpo = new FormData()
    corpo.append('file', arquivo, arquivo.name || 'print.png')
    try {
      // Sem Content-Type: o navegador monta o multipart com o boundary.
      const r = await fetch(`${API_URL}/hub/anexos`, { method: 'POST', headers: authHeaders(), body: corpo })
      const resposta = await r.json().catch(() => ({})) as {
        id?: string; previa?: string; truncado?: boolean; caracteres?: number; code?: string; message?: { code?: string }
      }
      if (!r.ok || !resposta.id) {
        const code = resposta.code ?? resposta.message?.code ?? ''
        atualizar(idLocal, { estado: 'erro', erro: MENSAGENS_DE_ERRO[code] ?? `falhou (${r.status})` })
        return
      }
      atualizar(idLocal, {
        estado: 'pronto', id: resposta.id, previa: resposta.previa, truncado: resposta.truncado, caracteres: resposta.caracteres,
      })
    } catch {
      atualizar(idLocal, { estado: 'erro', erro: 'sem conexão com o servidor' })
    }
  }, [])

  /** Acrescenta arquivos até o teto do turno; o excedente é dito, não descartado em silêncio. */
  // O envio fica FORA do `setAnexos`: a função de atualização pode rodar duas vezes no modo
  // estrito do React, e subiria o arquivo duas vezes.
  const adicionar = useCallback((arquivos: File[]): string | null => {
    const vagas = TETO_ANEXOS_NO_TURNO - anexos.filter((a) => a.estado !== 'erro').length
    const aviso = arquivos.length > vagas ? `No máximo ${TETO_ANEXOS_NO_TURNO} anexos por mensagem.` : null
    const novos = arquivos.slice(0, Math.max(0, vagas)).map((arquivo) => ({
      arquivo,
      item: {
        idLocal: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        nome: arquivo.name || 'print.png', tamanho: arquivo.size, estado: 'enviando' as const,
      },
    }))
    if (novos.length) {
      setAnexos((lista) => [...lista, ...novos.map((n) => n.item)])
      for (const n of novos) void enviarUm(n.arquivo, n.item.idLocal)
    }
    return aviso
  }, [anexos, enviarUm])

  const remover = useCallback((idLocal: string) => {
    setAnexos((lista) => lista.filter((a) => a.idLocal !== idLocal))
  }, [])

  const limpar = useCallback(() => setAnexos([]), [])

  return {
    anexos,
    adicionar,
    remover,
    limpar,
    idsProntos: anexos.filter((a) => a.estado === 'pronto' && a.id).map((a) => a.id!),
    enviando: anexos.some((a) => a.estado === 'enviando'),
  }
}
