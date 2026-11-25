import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import { WikiPageVersion } from '@prisma/client'

// ─── Types ────────────────────────────────────────────────────────────────────

export type VersionReason = 'compiled' | 'recompiled' | 'manual' | 'merged'
export type VersionAuthor = 'llm' | 'human'

export interface CreateVersionInput {
  pageId: string
  contentMd: string
  reason: VersionReason
  authorType: VersionAuthor
  diff?: string
}

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class WikiVersioningService {
  constructor(private readonly prisma: PrismaService) {}

  async createVersion(input: CreateVersionInput): Promise<WikiPageVersion> {
    return this.prisma.wikiPageVersion.create({
      data: {
        pageId: input.pageId,
        contentMd: input.contentMd,
        reason: input.reason,
        authorType: input.authorType,
        diff: input.diff ?? null,
      },
    })
  }

  async listVersions(pageId: string): Promise<WikiPageVersion[]> {
    return this.prisma.wikiPageVersion.findMany({
      where: { pageId },
      orderBy: { createdAt: 'desc' },
    })
  }

  async getVersion(versionId: string): Promise<WikiPageVersion | null> {
    return this.prisma.wikiPageVersion.findUnique({ where: { id: versionId } })
  }
}
