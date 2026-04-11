import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { PrismaService } from '../../prisma/prisma.service'
import { EventService } from '../event/event.service'
import { createHash } from 'crypto'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BrainIndexResult {
  id: string
  status: 'created' | 'updated'
  sourcePath: string
}

export interface BrainSearchResult {
  id: string
  content: string
  sourcePath: string | null
  metadata: Record<string, unknown>
  score: number
}

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class BrainService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly eventService: EventService,
  ) {}

  // ─── Embedding ──────────────────────────────────────────────────────────────

  async embed(text: string): Promise<number[]> {
    const jinaKey = this.config.get<string>('JINA_API_KEY')
    if (!jinaKey) throw new Error('JINA_API_KEY não configurado no .env')

    const res = await fetch('https://api.jina.ai/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${jinaKey}`,
      },
      body: JSON.stringify({ model: 'jina-embeddings-v3', input: [text], dimensions: 1024 }),
    })

    const data = await res.json() as { data?: Array<{ embedding: number[] }>; detail?: string; error?: string }

    if (!res.ok || !data.data?.[0]?.embedding) {
      throw new Error(`Jina API erro (HTTP ${res.status}): ${data.detail ?? data.error ?? JSON.stringify(data)}`)
    }

    return data.data[0].embedding
  }

  // ─── Chunking ────────────────────────────────────────────────────────────────

  chunkText(text: string, maxChars = 800): string[] {
    const chunks: string[] = []
    const paragraphs = text.split(/\n\n+/)
    let current = ''
    for (const para of paragraphs) {
      if (current.length + para.length > maxChars && current) {
        chunks.push(current.trim())
        current = para
      } else {
        current += (current ? '\n\n' : '') + para
      }
    }
    if (current.trim()) chunks.push(current.trim())
    return chunks.filter((c) => c.length > 50)
  }

  // ─── Index ───────────────────────────────────────────────────────────────────

  async indexDocument(
    content: string,
    sourcePath?: string,
    metadata?: Record<string, unknown>,
  ): Promise<BrainIndexResult> {
    const checksum = createHash('sha256').update(content).digest('hex')
    const vector = await this.embed(content)
    const path = sourcePath ?? 'manual'

    const existing = await this.prisma.document.findFirst({ where: { checksum } })

    if (existing) {
      await this.prisma.$executeRaw`
        UPDATE documents
        SET embedding = ${JSON.stringify(vector)}::vector,
            updated_at = NOW()
        WHERE id = ${existing.id}
      `
      return { id: existing.id, status: 'updated', sourcePath: path }
    }

    const id = crypto.randomUUID()
    await this.prisma.$executeRaw`
      INSERT INTO documents (id, source_path, content, embedding, metadata, checksum, created_at, updated_at)
      VALUES (
        ${id},
        ${path},
        ${content},
        ${JSON.stringify(vector)}::vector,
        ${JSON.stringify(metadata ?? {})}::jsonb,
        ${checksum},
        NOW(),
        NOW()
      )
    `
    return { id, status: 'created', sourcePath: path }
  }

  async indexUrl(rawUrl: string): Promise<{ indexed: number; documentIds: string[] }> {
    const url = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; rayzen-ai/1.0)' },
    })
    if (!res.ok) throw new Error(`Falha ao buscar URL: HTTP ${res.status}`)

    const html = await res.text()
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s{2,}/g, '\n')
      .trim()

    if (!text) throw new Error('Página sem conteúdo legível')

    const chunks = this.chunkText(text)
    const domain = new URL(url).hostname
    const documentIds: string[] = []

    for (const chunk of chunks) {
      const result = await this.indexDocument(chunk, `url/${domain}`, { type: 'url', url })
      documentIds.push(result.id)
    }

    this.eventService.create({
      source: 'brain',
      type: 'index',
      content: `URL indexada: ${url}`,
      metadata: { indexed: chunks.length, url },
    }).catch(() => null)

    return { indexed: chunks.length, documentIds }
  }

  async indexText(
    text: string,
    sourcePath?: string,
  ): Promise<{ indexed: number; documentIds: string[] }> {
    const chunks = this.chunkText(text)
    const documentIds: string[] = []

    for (const chunk of chunks) {
      const result = await this.indexDocument(chunk, sourcePath, { type: 'text' })
      documentIds.push(result.id)
    }

    this.eventService.create({
      source: 'brain',
      type: 'index',
      content: `Texto indexado: ${sourcePath ?? 'manual'}`,
      metadata: { indexed: chunks.length },
    }).catch(() => null)

    return { indexed: chunks.length, documentIds }
  }

  // ─── Search ──────────────────────────────────────────────────────────────────

  async search(query: string, limit = 5): Promise<BrainSearchResult[]> {
    const vector = await this.embed(query)

    const results = await this.prisma.$queryRaw<Array<{
      id: string
      content: string
      source_path: string | null
      metadata: Record<string, unknown>
      score: number
    }>>`
      SELECT id, content, source_path, metadata,
             1 - (embedding <=> ${JSON.stringify(vector)}::vector) AS score
      FROM documents
      WHERE embedding IS NOT NULL
      ORDER BY embedding <=> ${JSON.stringify(vector)}::vector
      LIMIT ${limit}
    `

    return results.map((r) => ({
      id: r.id,
      content: r.content,
      sourcePath: r.source_path,
      metadata: r.metadata as Record<string, unknown>,
      score: Number(r.score),
    }))
  }

  async getDocumentsByIds(ids: string[]): Promise<BrainSearchResult[]> {
    if (ids.length === 0) return []
    const docs = await this.prisma.document.findMany({
      where: { id: { in: ids } },
      select: { id: true, content: true, sourcePath: true, metadata: true },
    })
    return docs.map((d) => ({
      id: d.id,
      content: d.content,
      sourcePath: d.sourcePath,
      metadata: d.metadata as Record<string, unknown>,
      score: 1,
    }))
  }
}
