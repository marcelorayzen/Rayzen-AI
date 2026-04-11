import { Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import { EventService } from '../event/event.service'
import { BrainService } from '../brain/brain.service'
import { WikiCompilationService } from './wiki-compilation.service'
import { WikiMergeService, EditStatus } from './wiki-merge.service'
import { WikiVersioningService } from './wiki-versioning.service'
import { WikiPage, WikiPageVersion, WikiSourceReference } from '@prisma/client'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface WikiIndexInput {
  type: 'url' | 'text'
  source: string
  projectId?: string
}

export interface WikiIndexResult {
  pageId: string
  slug: string
  title: string
  status: 'created' | 'recompiled' | 'skipped'
  skipReason?: string
}

export type WikiPageDetail = WikiPage & {
  versions: WikiPageVersion[]
  sources: (WikiSourceReference & { document: { sourcePath: string | null; content: string } })[]
}

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class WikiService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly brain: BrainService,
    private readonly compilation: WikiCompilationService,
    private readonly merge: WikiMergeService,
    private readonly versioning: WikiVersioningService,
    private readonly eventService: EventService,
  ) {}

  // ─── Slug uniqueness ────────────────────────────────────────────────────────

  private async uniqueSlug(base: string): Promise<string> {
    let candidate = base
    let i = 2
    while (await this.prisma.wikiPage.findFirst({ where: { slug: candidate } })) {
      candidate = `${base}-${i++}`
    }
    return candidate
  }

  // ─── Find related pages ─────────────────────────────────────────────────────

  private async findRelated(keywords: string[], excludeSlug: string): Promise<string[]> {
    if (keywords.length === 0) return []
    const pages = await this.prisma.wikiPage.findMany({
      where: { slug: { not: excludeSlug } },
      select: { slug: true, title: true, tags: true },
    })
    return pages
      .filter((p) => {
        const text = `${p.title} ${p.tags.join(' ')}`.toLowerCase()
        return keywords.some((kw) => text.includes(kw.toLowerCase()))
      })
      .map((p) => p.slug)
      .slice(0, 4)
  }

  // ─── Link sources ────────────────────────────────────────────────────────────

  private async linkSources(
    pageId: string,
    sources: Array<{ id: string; score: number }>,
  ): Promise<void> {
    for (const src of sources) {
      await this.prisma.wikiSourceReference.upsert({
        where: { pageId_documentId: { pageId, documentId: src.id } },
        create: { pageId, documentId: src.id, relevanceScore: src.score },
        update: { relevanceScore: src.score, usedAt: new Date() },
      })
    }
  }

  // ─── Index (full pipeline) ───────────────────────────────────────────────────

  async index(input: WikiIndexInput, force = false): Promise<WikiIndexResult> {
    // 1. Indexar no Brain (fonte bruta + embedding)
    let documentIds: string[]
    if (input.type === 'url') {
      const result = await this.brain.indexUrl(input.source)
      documentIds = result.documentIds
    } else {
      const result = await this.brain.indexText(input.source)
      documentIds = result.documentIds
    }

    // 2. Recuperar fontes relevantes para contexto de compilação
    const rawContent = input.type === 'text' ? input.source : input.source
    const sources = await this.brain.search(rawContent.slice(0, 200), 5)

    // 3. Compilar draft via LLM
    const draft = await this.compilation.compile(
      input.type === 'text' ? input.source : rawContent,
      sources,
    )

    const slug = this.compilation.toSlug(draft.slug || draft.title)

    // 4. Verificar se WikiPage já existe
    const existing = await this.prisma.wikiPage.findFirst({ where: { slug } })

    if (!existing) {
      // 4a. Criar nova página
      const finalSlug = await this.uniqueSlug(slug)
      const related = await this.findRelated(draft.relatedKeywords, finalSlug)

      const page = await this.prisma.wikiPage.create({
        data: {
          slug: finalSlug,
          title: draft.title,
          tags: draft.tags,
          contentMd: draft.contentMd,
          related,
          editStatus: 'generated',
        },
      })

      await this.versioning.createVersion({
        pageId: page.id,
        contentMd: draft.contentMd,
        reason: 'compiled',
        authorType: 'llm',
      })

      await this.linkSources(page.id, sources.map((s) => ({ id: s.id, score: s.score })))

      this.eventService.create({
        source: 'brain',
        type: 'index',
        content: `Wiki criada: ${draft.title}`,
        metadata: { slug: finalSlug, documentIds },
      }).catch(() => null)

      return { pageId: page.id, slug: finalSlug, title: draft.title, status: 'created' }
    }

    // 4b. Página existe — aplicar merge/diff
    const mergeResult = this.merge.merge(
      existing.contentMd,
      draft.contentMd,
      existing.editStatus as EditStatus,
      force,
    )

    if (mergeResult.skipped) {
      return {
        pageId: existing.id,
        slug: existing.slug,
        title: existing.title,
        status: 'skipped',
        skipReason: mergeResult.skipReason,
      }
    }

    const related = await this.findRelated(draft.relatedKeywords, existing.slug)

    await this.prisma.wikiPage.update({
      where: { id: existing.id },
      data: {
        title: draft.title,
        tags: draft.tags,
        contentMd: mergeResult.contentMd,
        related,
        compiledAt: new Date(),
      },
    })

    await this.versioning.createVersion({
      pageId: existing.id,
      contentMd: mergeResult.contentMd,
      reason: 'recompiled',
      authorType: 'llm',
      diff: mergeResult.diff,
    })

    await this.linkSources(existing.id, sources.map((s) => ({ id: s.id, score: s.score })))

    this.eventService.create({
      source: 'brain',
      type: 'index',
      content: `Wiki recompilada: ${draft.title}`,
      metadata: { slug: existing.slug, diff: mergeResult.diff },
    }).catch(() => null)

    return { pageId: existing.id, slug: existing.slug, title: draft.title, status: 'recompiled' }
  }

  // ─── List ────────────────────────────────────────────────────────────────────

  async list(): Promise<WikiPage[]> {
    return this.prisma.wikiPage.findMany({
      orderBy: { compiledAt: 'desc' },
    })
  }

  // ─── Get by slug ─────────────────────────────────────────────────────────────

  async getBySlug(slug: string): Promise<WikiPageDetail> {
    const page = await this.prisma.wikiPage.findUnique({
      where: { slug },
      include: {
        versions: { orderBy: { createdAt: 'desc' }, take: 10 },
        sources: {
          include: { document: { select: { sourcePath: true, content: true } } },
          orderBy: { relevanceScore: 'desc' },
        },
      },
    })
    if (!page) throw new NotFoundException(`Nota não encontrada: ${slug}`)
    return page
  }

  // ─── Update (human edit) ─────────────────────────────────────────────────────

  async update(slug: string, contentMd: string): Promise<WikiPage> {
    const page = await this.prisma.wikiPage.findUnique({ where: { slug } })
    if (!page) throw new NotFoundException(`Nota não encontrada: ${slug}`)

    const diff = this.merge.computeDiff(page.contentMd, contentMd)

    const updated = await this.prisma.wikiPage.update({
      where: { slug },
      data: { contentMd, editStatus: 'human_edited' },
    })

    await this.versioning.createVersion({
      pageId: page.id,
      contentMd,
      reason: 'manual',
      authorType: 'human',
      diff,
    })

    this.eventService.create({
      source: 'brain',
      type: 'note',
      content: `Wiki editada: ${slug}`,
      metadata: { slug, diff },
    }).catch(() => null)

    return updated
  }

  // ─── Delete ──────────────────────────────────────────────────────────────────

  async delete(slug: string): Promise<{ deleted: boolean }> {
    const page = await this.prisma.wikiPage.findUnique({ where: { slug } })
    if (!page) throw new NotFoundException(`Nota não encontrada: ${slug}`)
    await this.prisma.wikiPage.delete({ where: { slug } })
    return { deleted: true }
  }

  // ─── Versions ────────────────────────────────────────────────────────────────

  async listVersions(slug: string): Promise<WikiPageVersion[]> {
    const page = await this.prisma.wikiPage.findUnique({ where: { slug } })
    if (!page) throw new NotFoundException(`Nota não encontrada: ${slug}`)
    return this.versioning.listVersions(page.id)
  }

  // ─── Sources ─────────────────────────────────────────────────────────────────

  async listSources(slug: string) {
    const page = await this.prisma.wikiPage.findUnique({ where: { slug } })
    if (!page) throw new NotFoundException(`Nota não encontrada: ${slug}`)
    return this.prisma.wikiSourceReference.findMany({
      where: { pageId: page.id },
      include: { document: { select: { id: true, sourcePath: true, createdAt: true } } },
      orderBy: { relevanceScore: 'desc' },
    })
  }
}
