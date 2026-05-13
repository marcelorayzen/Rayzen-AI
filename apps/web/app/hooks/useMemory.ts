'use client'

import { useState, useCallback } from 'react'
import { API_URL } from '../../lib/api-url'
import { authHeaders } from '../../lib/api-client'

export interface MemoryDoc {
  id: string
  sourcePath: string | null
  metadata?: Record<string, unknown> | null
  projectId?: string | null
  createdAt: string
}

export interface MemorySearchResult {
  id: string
  content: string
  sourcePath: string | null
  score: number
}

export function useMemory(activeProjectId: string | null) {
  const [memoryOpen, setMemoryOpen] = useState(false)
  const [memoryDocs, setMemoryDocs] = useState<MemoryDoc[]>([])
  const [memoryDocsLoading, setMemoryDocsLoading] = useState(false)
  const [memorySearch, setMemorySearch] = useState('')
  const [memoryListFilter, setMemoryListFilter] = useState('')
  const [memorySearchResults, setMemorySearchResults] = useState<MemorySearchResult[] | null>(null)
  const [memorySearching, setMemorySearching] = useState(false)

  const openMemoryPanel = useCallback(async () => {
    setMemoryOpen(true)
    setMemorySearch('')
    setMemorySearchResults(null)
    setMemoryDocsLoading(true)
    try {
      const url = activeProjectId
        ? `${API_URL}/memory/documents?projectId=${activeProjectId}`
        : `${API_URL}/memory/documents`
      const res = await fetch(url, { headers: authHeaders() })
      const data = await res.json() as MemoryDoc[]
      setMemoryDocs(data)
    } catch { /* silencioso */ }
    finally { setMemoryDocsLoading(false) }
  }, [activeProjectId])

  const handleMemorySearch = useCallback(async () => {
    if (!memorySearch.trim()) { setMemorySearchResults(null); return }
    setMemorySearching(true)
    try {
      const res = await fetch(`${API_URL}/memory/search`, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ query: memorySearch.trim(), sessionId: 'memory-panel', ...(activeProjectId ? { projectId: activeProjectId } : {}) }),
      })
      const data = await res.json() as { sources?: MemorySearchResult[] }
      setMemorySearchResults(data.sources ?? [])
    } catch { setMemorySearchResults([]) }
    finally { setMemorySearching(false) }
  }, [memorySearch, activeProjectId])

  const deleteMemoryDoc = useCallback(async (id: string) => {
    await fetch(`${API_URL}/memory/documents/${id}`, { method: 'DELETE', headers: authHeaders() })
    setMemoryDocs(prev => prev.filter(d => d.id !== id))
  }, [])

  return {
    memoryOpen, setMemoryOpen,
    memoryDocs, setMemoryDocs,
    memoryDocsLoading,
    memorySearch, setMemorySearch,
    memoryListFilter, setMemoryListFilter,
    memorySearchResults, setMemorySearchResults,
    memorySearching,
    openMemoryPanel,
    handleMemorySearch,
    deleteMemoryDoc,
  }
}
