import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Client } from '@notionhq/client'
import { PrismaService } from '../../prisma/prisma.service'
import type {
  PageObjectResponse,
  PartialPageObjectResponse,
  DatabaseObjectResponse,
  PartialDatabaseObjectResponse,
  BlockObjectResponse,
  RichTextItemResponse,
} from '@notionhq/client/build/src/api-endpoints'

export interface NotionPage {
  id: string
  title: string
  url: string
  lastEdited: string
  properties: Record<string, unknown>
}

export interface NotionSearchResult {
  pages: NotionPage[]
  total: number
}

export interface CreatePageResult {
  id: string
  url: string
  title: string
}

type SearchResultItem = PageObjectResponse | PartialPageObjectResponse | DatabaseObjectResponse | PartialDatabaseObjectResponse | Record<string, unknown>

function extractTitle(item: SearchResultItem): string {
  if (typeof item !== 'object' || item === null || !('properties' in item)) return 'Sem título'
  const props = (item as { properties: Record<string, unknown> }).properties
  const titleProp = props['title'] ?? props['Name'] ?? Object.values(props).find((p) => (p as { type?: string })?.type === 'title')
  if (!titleProp) return 'Sem título'
  const tp = titleProp as { type?: string; title?: RichTextItemResponse[] }
  if (tp.type === 'title' && Array.isArray(tp.title)) {
    return tp.title.map((t: RichTextItemResponse) => t.plain_text).join('')
  }
  return 'Sem título'
}

function toNotionPage(item: SearchResultItem): NotionPage {
  const page = item as PageObjectResponse
  return {
    id: page.id,
    title: extractTitle(item),
    url: page.url ?? '',
    lastEdited: page.last_edited_time ?? '',
    properties: 'properties' in page ? page.properties : {},
  }
}

function markdownToNotionBlocks(markdown: string): unknown[] {
  const blocks: unknown[] = []
  for (const line of markdown.split('\n')) {
    if (!line.trim()) continue

    if (line.startsWith('## ')) {
      blocks.push({ object: 'block', type: 'heading_2', heading_2: { rich_text: [{ type: 'text', text: { content: line.slice(3) } }] } })
    } else if (line.startsWith('# ')) {
      blocks.push({ object: 'block', type: 'heading_1', heading_1: { rich_text: [{ type: 'text', text: { content: line.slice(2) } }] } })
    } else if (line.startsWith('### ')) {
      blocks.push({ object: 'block', type: 'heading_3', heading_3: { rich_text: [{ type: 'text', text: { content: line.slice(4) } }] } })
    } else if (line.startsWith('- ')) {
      blocks.push({ object: 'block', type: 'bulleted_list_item', bulleted_list_item: { rich_text: [{ type: 'text', text: { content: line.slice(2) } }] } })
    } else if (/^\d+\.\s/.test(line)) {
      blocks.push({ object: 'block', type: 'numbered_list_item', numbered_list_item: { rich_text: [{ type: 'text', text: { content: line.replace(/^\d+\.\s/, '') } }] } })
    } else if (line.startsWith('> ')) {
      blocks.push({ object: 'block', type: 'quote', quote: { rich_text: [{ type: 'text', text: { content: line.slice(2) } }] } })
    } else {
      blocks.push({ object: 'block', type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: line } }] } })
    }
  }
  return blocks
}

const DOC_TYPE_LABELS: Record<string, string> = {
  project_state:  'Estado do Projeto',
  decisions_log:  'Log de Decisões',
  next_actions:   'Próximas Ações',
  work_journal:   'Diário de Trabalho',
  data_map:       'Mapeamento de Dados Pessoais',
  ropa:           'ROPA — Registro de Atividades de Tratamento',
  quality_report: 'Relatório de Qualidade de Dados',
}

@Injectable()
export class NotionService {
  private client: Client
  private defaultDatabaseId: string

  constructor(private config: ConfigService, private prisma: PrismaService) {
    this.client = new Client({
      auth: this.config.get<string>('NOTION_API_KEY', ''),
    })
    this.defaultDatabaseId = this.config.get<string>('NOTION_DATABASE_ID', '')
  }

  async search(query: string, limit = 10): Promise<NotionSearchResult> {
    const res = await this.client.search({
      query,
      filter: { property: 'object', value: 'page' },
      page_size: limit,
    })
    const pages = (res.results as SearchResultItem[]).map(toNotionPage)
    return { pages, total: pages.length }
  }

  async getPage(pageId: string): Promise<{ page: NotionPage; content: string }> {
    const page = await this.client.pages.retrieve({ page_id: pageId }) as PageObjectResponse

    const blocksRes = await this.client.blocks.children.list({ block_id: pageId, page_size: 100 })
    const content = blocksRes.results
      .map((b) => {
        const block = b as BlockObjectResponse
        const richText = (block as unknown as Record<string, { rich_text?: RichTextItemResponse[] }>)[block.type]?.rich_text
        if (Array.isArray(richText)) return richText.map((t: RichTextItemResponse) => t.plain_text).join('')
        return ''
      })
      .filter(Boolean)
      .join('\n')

    return { page: toNotionPage(page), content }
  }

  async createPage(opts: {
    title: string
    content: string
    parentPageId?: string
    parentDatabaseId?: string
    tags?: string[]
  }): Promise<CreatePageResult> {
    const parentId = opts.parentPageId ?? opts.parentDatabaseId ?? this.defaultDatabaseId

    if (!parentId) {
      throw new NotFoundException('parentPageId ou NOTION_DATABASE_ID necessário para criar página')
    }

    const parent = opts.parentDatabaseId || (!opts.parentPageId && this.defaultDatabaseId)
      ? { database_id: opts.parentDatabaseId ?? this.defaultDatabaseId }
      : { page_id: opts.parentPageId as string }

    const properties = {
      title: { title: [{ type: 'text' as const, text: { content: opts.title } }] },
      ...(opts.tags?.length && (opts.parentDatabaseId ?? this.defaultDatabaseId)
        ? { Tags: { multi_select: opts.tags.map((name) => ({ name })) } }
        : {}),
    }

    const blocks = markdownToNotionBlocks(opts.content)

    const res = await this.client.pages.create({
      parent,
      properties,
      children: blocks as Parameters<typeof this.client.pages.create>[0]['children'],
    }) as PageObjectResponse

    return { id: res.id, url: res.url, title: opts.title }
  }

  async appendToPage(pageId: string, content: string): Promise<{ id: string; blocksAdded: number }> {
    const blocks = markdownToNotionBlocks(content)
    await this.client.blocks.children.append({
      block_id: pageId,
      children: blocks as Parameters<typeof this.client.blocks.children.append>[0]['children'],
    })
    return { id: pageId, blocksAdded: blocks.length }
  }

  async updatePageTitle(pageId: string, title: string): Promise<{ id: string; title: string }> {
    await this.client.pages.update({
      page_id: pageId,
      properties: {
        title: { title: [{ text: { content: title } }] },
      },
    })
    return { id: pageId, title }
  }

  // Publica documentos gerados do projeto no banco Notion vinculado
  async syncProject(projectId: string, docTypes?: string[]): Promise<{
    synced: Array<{ type: string; notionPageId: string; url: string; status: 'created' | 'updated' }>
    skipped: string[]
    databaseId: string
  }> {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } })
    if (!project) throw new NotFoundException('Projeto não encontrado')

    const dbId = project.notionDatabaseId ?? this.defaultDatabaseId
    if (!dbId) {
      throw new BadRequestException(
        'Nenhum notionDatabaseId configurado para este projeto. ' +
        'Use PATCH /projects/:id com { "notionDatabaseId": "seu-database-id" }.',
      )
    }

    const docs = await this.prisma.projectDocument.findMany({
      where: {
        projectId,
        ...(docTypes?.length ? { type: { in: docTypes } } : {}),
      },
    })

    if (docs.length === 0) {
      throw new BadRequestException('Nenhum documento gerado. Use POST /documentation/generate/:projectId primeiro.')
    }

    const synced: Array<{ type: string; notionPageId: string; url: string; status: 'created' | 'updated' }> = []
    const skipped: string[] = []

    for (const doc of docs) {
      const title = `${project.name} — ${DOC_TYPE_LABELS[doc.type] ?? doc.type}`

      try {
        // Busca página existente no banco com o mesmo título
        const search = await this.client.search({
          query: title,
          filter: { property: 'object', value: 'page' },
          page_size: 5,
        })

        const existing = search.results.find(r => {
          const p = r as PageObjectResponse
          return 'parent' in p &&
            p.parent &&
            'database_id' in p.parent &&
            p.parent.database_id.replace(/-/g, '') === dbId.replace(/-/g, '') &&
            extractTitle(p) === title
        }) as PageObjectResponse | undefined

        const blocks = markdownToNotionBlocks(doc.content)

        if (existing) {
          // Limpa blocos existentes e reescreve
          const existingBlocks = await this.client.blocks.children.list({ block_id: existing.id, page_size: 100 })
          await Promise.all(
            existingBlocks.results.map(b => this.client.blocks.delete({ block_id: b.id }))
          )
          await this.client.blocks.children.append({
            block_id: existing.id,
            children: blocks as Parameters<typeof this.client.blocks.children.append>[0]['children'],
          })
          synced.push({ type: doc.type, notionPageId: existing.id, url: existing.url, status: 'updated' })
        } else {
          const created = await this.client.pages.create({
            parent: { database_id: dbId },
            properties: {
              title: { title: [{ type: 'text', text: { content: title } }] },
            },
            children: blocks as Parameters<typeof this.client.pages.create>[0]['children'],
          }) as PageObjectResponse
          synced.push({ type: doc.type, notionPageId: created.id, url: created.url, status: 'created' })
        }
      } catch (err) {
        skipped.push(`${doc.type}: ${(err as Error).message}`)
      }
    }

    return { synced, skipped, databaseId: dbId }
  }
}
