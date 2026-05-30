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
