import { Injectable, Logger } from '@nestjs/common'

// HTTP client para a API V1 — V2 usa isso para operações de escrita no storage V1
@Injectable()
export class V1ApiService {
  private readonly logger = new Logger(V1ApiService.name)
  private readonly baseUrl: string
  private readonly token: string

  constructor() {
    this.baseUrl = (process.env.V1_API_URL ?? 'http://api:3001').replace(/\/$/, '')
    this.token   = process.env.V1_API_TOKEN ?? process.env.AGENT_TOKEN ?? ''
  }

  private get headers() {
    return { 'Content-Type': 'application/json', Authorization: `Bearer ${this.token}` }
  }

  async searchMemory(projectId: string, query: string, limit = 10): Promise<MemorySearchResult[]> {
    try {
      const res = await fetch(`${this.baseUrl}/memory/search`, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify({ projectId, query, limit }),
      })
      if (!res.ok) return []
      // V1 /memory/search returns {answer, sources, tokensUsed}
      const data = await res.json() as { sources?: MemorySearchResult[]; results?: MemorySearchResult[] }
      return data.sources ?? data.results ?? []
    } catch (e) {
      this.logger.warn(`memory search failed: ${e}`)
      return []
    }
  }

  async indexContent(payload: IndexPayload): Promise<{ id?: string }> {
    const res = await fetch(`${this.baseUrl}/memory/index`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify(payload),
    })
    if (!res.ok) throw new Error(`V1 index failed: ${res.status}`)
    return res.json() as Promise<{ id?: string }>
  }

  async listDocuments(projectId: string, limit = 50): Promise<MemoryDocument[]> {
    try {
      const res = await fetch(`${this.baseUrl}/memory/documents?projectId=${projectId}&limit=${limit}`, {
        headers: this.headers,
      })
      if (!res.ok) return []
      return res.json() as Promise<MemoryDocument[]>
    } catch {
      return []
    }
  }

  // ─── Wiki ──────────────────────────────────────────────────────────────────

  async listWikiPages(): Promise<Array<{ slug: string; title: string; projectId?: string }>> {
    try {
      const res = await fetch(`${this.baseUrl}/wiki`, { headers: this.headers })
      if (!res.ok) return []
      return res.json() as Promise<Array<{ slug: string; title: string; projectId?: string }>>
    } catch { return [] }
  }

  async getWikiPage(slug: string): Promise<{ slug: string; title: string; content: string; projectId?: string } | null> {
    try {
      const res = await fetch(`${this.baseUrl}/wiki/${slug}`, { headers: this.headers })
      if (!res.ok) return null
      return res.json() as Promise<{ slug: string; title: string; content: string; projectId?: string }>
    } catch { return null }
  }

  // ─── Documentation ────────────────────────────────────────────────────────

  async getProjectDocs(projectId: string): Promise<Array<{ type: string; content: string }>> {
    try {
      const res = await fetch(`${this.baseUrl}/documentation/${projectId}`, { headers: this.headers })
      if (!res.ok) return []
      return res.json() as Promise<Array<{ type: string; content: string }>>
    } catch { return [] }
  }

  // ─── Events ───────────────────────────────────────────────────────────────

  async getDecisionEvents(projectId: string, limit = 30): Promise<Array<{ id: string; content: string; type: string }>> {
    try {
      const res = await fetch(`${this.baseUrl}/events?projectId=${projectId}&type=decision&limit=${limit}`, {
        headers: this.headers,
      })
      if (!res.ok) return []
      const data = await res.json() as { events?: Array<{ id: string; content: string; type: string }> } | Array<{ id: string; content: string; type: string }>
      return Array.isArray(data) ? data : (data.events ?? [])
    } catch { return [] }
  }

  async deleteDocument(documentId: string): Promise<void> {
    await fetch(`${this.baseUrl}/memory/documents/${documentId}`, {
      method: 'DELETE',
      headers: this.headers,
    })
  }
}

export interface MemorySearchResult {
  id:        string
  content:   string
  score:     number
  projectId: string
  metadata?: Record<string, unknown>
}

export interface MemoryDocument {
  id:          string
  projectId:   string
  content:     string
  sourcePath?: string
  sourceType?: string
  memoryClass?: string
  createdAt:   string
}

export interface IndexPayload {
  projectId:  string
  content:    string
  sourcePath?: string
  sourceType?: string
  metadata?:  Record<string, unknown>
}
