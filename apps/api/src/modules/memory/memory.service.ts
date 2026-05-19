import { Injectable, NotFoundException, BadGatewayException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { PrismaService } from '../../prisma/prisma.service'
import OpenAI from 'openai'
import { createHash } from 'crypto'
import { EventService } from '../event/event.service'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require('pdf-parse') as (buf: Buffer) => Promise<{ text: string }>

export interface IndexResult {
  id: string
  status: 'created' | 'updated'
}

export interface SearchResult {
  id: string
  content: string
  sourcePath: string | null
  metadata: Record<string, unknown>
  score: number
}

export interface SearchSynthesis {
  answer: string
  sources: SearchResult[]
  tokensUsed: number
}

@Injectable()
export class MemoryService {
  constructor(
    private readonly prisma: PrismaService,
    private config: ConfigService,
    private eventService: EventService,
  ) {}

  private async embed(text: string): Promise<number[]> {
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

  async indexDocument(content: string, sourcePath?: string, metadata?: Record<string, unknown>, projectId?: string): Promise<IndexResult> {
    const checksum = createHash('sha256').update(content).digest('hex')

    const vector = await this.embed(content)

    const existing = await this.prisma.document.findFirst({ where: { checksum } })

    if (existing) {
      await this.prisma.$executeRaw`
        UPDATE documents
        SET embedding = ${JSON.stringify(vector)}::vector,
            updated_at = NOW()
        WHERE id = ${existing.id}
      `
      if (projectId) {
        await this.prisma.document.update({ where: { id: existing.id }, data: { projectId } })
      }
      return { id: existing.id, status: 'updated' }
    }

    const id = crypto.randomUUID()
    await this.prisma.$executeRaw`
      INSERT INTO documents (id, source_path, content, embedding, metadata, checksum, project_id, created_at, updated_at)
      VALUES (
        ${id},
        ${sourcePath ?? null},
        ${content},
        ${JSON.stringify(vector)}::vector,
        ${JSON.stringify(metadata ?? {})}::jsonb,
        ${checksum},
        ${projectId ?? null},
        NOW(),
        NOW()
      )
    `
    return { id, status: 'created' }
  }

  async search(query: string, limit = 5, projectId?: string): Promise<SearchResult[]> {
    const vector = await this.embed(query)

    const results = projectId
      ? await this.prisma.$queryRaw<Array<{
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
          AND project_id = ${projectId}
        ORDER BY embedding <=> ${JSON.stringify(vector)}::vector
        LIMIT ${limit}
      `
      : await this.prisma.$queryRaw<Array<{
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

  async countDocuments(projectId?: string) {
    return this.prisma.document.count({ where: projectId ? { projectId } : undefined })
  }

  private isMemoryInventoryQuestion(query: string) {
    const normalized = query.toLowerCase()
    return /\b(quantas?|qtd|total|existem|tem|tenho|acesso|indexa[cç][õo]es?|chunks?|documentos?)\b/.test(normalized)
      && /\b(brain|mem[oó]ria|indexa[cç][õo]es?|chunks?|documentos?|acesso)\b/.test(normalized)
  }

  private async saveBrainExchange(sessionId: string, query: string, answer: string, tokensUsed: number, projectId?: string) {
    await this.prisma.conversationMessage.createMany({
      data: [
        { sessionId, module: 'brain', role: 'user', content: query, projectId: projectId ?? null },
        { sessionId, module: 'brain', role: 'assistant', content: answer, tokensUsed, projectId: projectId ?? null },
      ],
    })
  }

  async searchAndSynthesize(query: string, sessionId: string, projectId?: string): Promise<SearchSynthesis> {
    const totalDocs = await this.countDocuments(projectId)
    const scope = projectId ? 'neste projeto' : 'na base global'

    if (this.isMemoryInventoryQuestion(query)) {
      const answer = totalDocs > 0
        ? `Tenho acesso operacional ao Brain ${scope}: há ${totalDocs} chunks/documentos indexados. Para responder sobre conteúdo, eu ainda preciso consultar os trechos relevantes; a contagem sozinha não prova o conteúdo de cada indexação.`
        : `Consultei o Brain ${scope}, mas não há chunks/documentos indexados nesse escopo.`
      await this.saveBrainExchange(sessionId, query, answer, 0, projectId)
      return { answer, sources: [], tokensUsed: 0 }
    }

    const sources = await this.search(query, 5, projectId)

    if (sources.length === 0) {
      const answer = totalDocs > 0
        ? `Consultei o Brain ${scope}, que tem ${totalDocs} chunks/documentos indexados, mas não encontrei trechos relevantes para responder com segurança.`
        : `Consultei o Brain ${scope}, mas não há documentos indexados nesse escopo.`
      await this.saveBrainExchange(sessionId, query, answer, 0, projectId)
      return { answer, sources: [], tokensUsed: 0 }
    }

    const context = sources
      .map((s, i) => `[${i + 1}] ${s.sourcePath ? `(${s.sourcePath}) ` : ''}${s.content.slice(0, 500)}`)
      .join('\n\n')

    const llm = new OpenAI({
      baseURL: this.config.get('LITELLM_BASE_URL', 'http://localhost:4000/v1'),
      apiKey: this.config.get('LITELLM_MASTER_KEY'),
    })

    const res = await llm.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'Responda somente com base nos documentos encontrados e nas estatisticas explicitas fornecidas. Nao confirme numeros, fatos ou acesso que nao estejam nos documentos ou nas estatisticas.',
        },
        {
          role: 'system',
          content: `Você é Rayzen, um assistente com acesso à base de conhecimento pessoal do usuário.
Com base nos documentos encontrados, responda a pergunta de forma clara e direta.
Se a informação não estiver nos documentos, diga isso honestamente.
Língua: português brasileiro.`,
        },
        {
          role: 'user',
          content: `Pergunta: ${query}\n\nEstatisticas do Brain: ${totalDocs} chunks/documentos indexados ${scope}.\n\nDocumentos encontrados:\n${context}`,
        },
      ],
      temperature: 0.3,
    })

    const answer = res.choices[0].message.content ?? ''
    const tokensUsed = res.usage?.total_tokens ?? 0

    await this.saveBrainExchange(sessionId, query, answer, tokensUsed, projectId)

    return { answer, sources, tokensUsed }
  }

  async listDocuments(projectId?: string) {
    return this.prisma.document.findMany({
      where: projectId ? { projectId } : undefined,
      select: { id: true, sourcePath: true, metadata: true, checksum: true, projectId: true, createdAt: true, updatedAt: true },
      orderBy: { createdAt: 'desc' },
    })
  }

  async deleteDocument(id: string) {
    await this.prisma.document.delete({ where: { id } })
    return { deleted: true }
  }

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

  async indexGithub(username: string, token?: string, projectId?: string, repository?: string): Promise<{ indexed: number; repos: number }> {
    const headers: Record<string, string> = { 'User-Agent': 'rayzen-ai' }
    if (token) headers['Authorization'] = `Bearer ${token}`

    const repoFilter = repository?.trim()
      .replace(/^https?:\/\/github\.com\//, '')
      .replace(/\.git$/, '')
      .replace(/\/$/, '')

    let reposRes: Response
    let reposData: unknown
    if (repoFilter) {
      const fullName = repoFilter.includes('/') ? repoFilter : `${username}/${repoFilter}`
      reposRes = await fetch(`https://api.github.com/repos/${fullName}`, { headers })
      reposData = reposRes.ok ? [await reposRes.json()] : await reposRes.json()
    } else {
      reposRes = await fetch(
        `https://api.github.com/users/${username}/repos?per_page=100&sort=updated`,
        { headers },
      )
      reposData = await reposRes.json()
    }

    if (!reposRes.ok || !Array.isArray(reposData)) {
      if (reposRes.status === 404) {
        throw new NotFoundException(repoFilter
          ? `Repositório "${repoFilter}" não encontrado no GitHub`
          : `Usuário "@${username}" não encontrado no GitHub`)
      }
      if (reposRes.status === 403) {
        throw new BadGatewayException('Rate limit do GitHub atingido — tente novamente em alguns minutos ou forneça um token')
      }
      const msg = (reposData as { message?: string })?.message ?? JSON.stringify(reposData)
      throw new BadGatewayException(`GitHub API retornou erro (HTTP ${reposRes.status}): ${msg}`)
    }

    const repos = reposData as Array<{ name: string; description: string | null; full_name: string }>

    let indexed = 0
    for (const repo of repos) {
      const groupKey = `github/${repo.full_name}`
      const desc = `Repositório GitHub: ${repo.name}${repo.description ? ` — ${repo.description}` : ''}`
      await this.indexDocument(desc, `github/${repo.full_name}`, { type: 'repo', groupKey, groupLabel: repo.full_name }, projectId)

      try {
        const readmeRes = await fetch(
          `https://api.github.com/repos/${repo.full_name}/readme`,
          { headers },
        )
        if (readmeRes.ok) {
          const readmeData = await readmeRes.json() as { content: string }
          const text = Buffer.from(readmeData.content, 'base64').toString('utf-8')
          const chunks = this.chunkText(text)
          for (const chunk of chunks) {
            await this.indexDocument(chunk, `github/${repo.full_name}/README`, { type: 'readme', repo: repo.full_name, groupKey, groupLabel: repo.full_name }, projectId)
            indexed++
          }
        }
      } catch { /* sem README, ok */ }

      indexed++
    }

    this.eventService.create({
      source: 'memory',
      type: 'index',
      content: repoFilter ? `GitHub ${repoFilter}` : `GitHub @${username}`,
      metadata: { indexed, repos: repos.length, repository: repoFilter },
      projectId,
    }).catch(() => null)
    return { indexed, repos: repos.length }
  }

  async indexFile(buffer: Buffer, filename: string, sourcePath?: string, projectId?: string): Promise<{ indexed: number }> {
    let text = ''

    if (filename.endsWith('.pdf')) {
      const parsed = await pdfParse(buffer)
      text = parsed.text
    } else {
      text = buffer.toString('utf-8')
    }

    const chunks = this.chunkText(text)
    const path = sourcePath ?? `file/${filename}`
    const groupKey = path

    for (const chunk of chunks) {
      await this.indexDocument(chunk, path, { type: 'file', filename, groupKey, groupLabel: filename }, projectId)
    }

    this.eventService.create({ source: 'memory', type: 'index', content: `Arquivo: ${filename}`, metadata: { indexed: chunks.length, filename } }).catch(() => null)
    return { indexed: chunks.length }
  }

  async indexNotion(integrationToken: string, rootPageId?: string, projectId?: string): Promise<{ indexed: number; pages: number }> {
    const headers = {
      Authorization: `Bearer ${integrationToken}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    }

    // Busca todas as páginas acessíveis pela integration
    const searchRes = await fetch('https://api.notion.com/v1/search', {
      method: 'POST',
      headers,
      body: JSON.stringify({ filter: { property: 'object', value: 'page' }, page_size: 100 }),
    })

    if (!searchRes.ok) {
      if (searchRes.status === 401) throw new Error('Token do Notion inválido ou sem permissão — verifique a Integration Token')
      const err = await searchRes.json() as { message?: string }
      throw new Error(`Notion API erro (HTTP ${searchRes.status}): ${err.message ?? 'desconhecido'}`)
    }

    const searchData = await searchRes.json() as {
      results: Array<{
        id: string
        object: string
        properties?: Record<string, { type?: string; title?: Array<{ plain_text: string }> }>
        title?: Array<{ plain_text: string }>
        child_page?: { title?: string }
      }>
    }

    let pages = searchData.results
    if (rootPageId) {
      // Normaliza: remove hífens, slug e query string, depois reformata como UUID
      const raw = rootPageId.replace(/\?.*/, '').split('/').pop() ?? rootPageId
      const normalizedId = raw.replace(/-/g, '')
      const formatted = normalizedId.length === 32
        ? `${normalizedId.slice(0,8)}-${normalizedId.slice(8,12)}-${normalizedId.slice(12,16)}-${normalizedId.slice(16,20)}-${normalizedId.slice(20)}`
        : rootPageId

      pages = pages.filter((p) => p.id === formatted || p.id === normalizedId || p.id.replace(/-/g, '') === normalizedId)
      if (pages.length === 0) {
        // A página pode não estar nos resultados de search mas estar acessível diretamente
        const pageRes = await fetch(`https://api.notion.com/v1/pages/${formatted}`, { headers })
        if (pageRes.ok) {
          const page = await pageRes.json() as typeof pages[0]
          pages = [page]
        } else {
          const errBody = await pageRes.json().catch(() => ({})) as { message?: string; code?: string }
          const hint = pageRes.status === 404
            ? 'Página não encontrada — verifique se a integração foi compartilhada com esta página no Notion (Share → Connect to integration)'
            : errBody.message ?? `HTTP ${pageRes.status}`
          throw new Error(`Notion: ${hint}`)
        }
      }
    } else if (pages.length === 0) {
      throw new Error('Notion: nenhuma página encontrada. Compartilhe pelo menos uma página com a integração (Share → Connect to integration)')
    }

    let indexed = 0

    for (const page of pages) {
      // Extrai título — tenta múltiplos formatos da API do Notion
      let title = 'Sem título'
      if (page.properties) {
        // Página de database: property com type === 'title'
        const titleProp = Object.values(page.properties).find((p) => p.type === 'title' || Array.isArray(p.title))
        if (titleProp?.title?.[0]?.plain_text) title = titleProp.title[0].plain_text
      }
      if (title === 'Sem título' && page.title?.[0]?.plain_text) {
        title = page.title[0].plain_text
      }
      if (title === 'Sem título' && page.child_page?.title) {
        title = page.child_page.title
      }

      const pageText = await this.fetchNotionBlocks(page.id, headers)
      const fullText = `${title}\n\n${pageText}`.trim()
      // Indexa mesmo que só tenha o título (blocos podem estar inacessíveis)
      if (!fullText || fullText.length < 5) continue

      const chunks = this.chunkText(fullText)
      const groupKey = `notion/${page.id}`
      for (const chunk of chunks) {
        await this.indexDocument(chunk, `notion/${page.id}`, { type: 'notion', title, groupKey, groupLabel: title }, projectId)
        indexed++
      }
    }

    this.eventService.create({
      source: 'memory',
      type: 'index',
      content: `Notion: ${pages.length} páginas`,
      metadata: { indexed, pages: pages.length },
      projectId,
    }).catch(() => null)

    return { indexed, pages: pages.length }
  }

  private async fetchNotionBlocks(
    blockId: string,
    headers: Record<string, string>,
    depth = 0,
  ): Promise<string> {
    if (depth > 3) return '' // evita recursão excessiva

    const res = await fetch(`https://api.notion.com/v1/blocks/${blockId}/children?page_size=100`, { headers })
    if (!res.ok) {
      // 403 = integração sem permissão de leitura neste bloco; não é erro fatal
      return ''
    }

    const data = await res.json() as {
      results: Array<{
        type: string
        has_children?: boolean
        id: string
        [key: string]: unknown
      }>
    }

    const lines: string[] = []
    for (const block of data.results) {
      const richText = (block[block.type] as { rich_text?: Array<{ plain_text: string }> } | undefined)?.rich_text
      const text = richText?.map((t) => t.plain_text).join('') ?? ''
      if (text.trim()) lines.push(text.trim())

      if (block.has_children) {
        const childText = await this.fetchNotionBlocks(block.id, headers, depth + 1)
        if (childText) lines.push(childText)
      }
    }

    return lines.join('\n')
  }

  async indexUrl(rawUrl: string, projectId?: string): Promise<{ indexed: number }> {
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
    const groupKey = `url/${domain}`

    for (const chunk of chunks) {
      await this.indexDocument(chunk, `url/${domain}`, { type: 'url', url, groupKey, groupLabel: url }, projectId)
    }

    return { indexed: chunks.length }
  }
}
