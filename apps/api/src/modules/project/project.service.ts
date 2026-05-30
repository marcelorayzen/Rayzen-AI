import { Injectable, Inject, forwardRef } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import { NotionService } from '../notion/notion.service'

// Normaliza slug/nome para comparação tolerante:
// lowercase, _ → -, remove sufixos de visibilidade, remove não-alfanuméricos
// "rayzen-ai-private" → "rayzen-ai" ; "Rayzen AI" → "rayzen-ai" ; "vb_ferragens" → "vb-ferragens"
export function normalizeSlug(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/-(private|public|fork|main|master)$/g, '')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

@Injectable()
export class ProjectService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => NotionService)) private readonly notion: NotionService,
  ) {}

  async findAll(repoSlug?: string) {
    if (repoSlug) {
      // 1. Match exato (rápido, usa índice)
      const exact = await this.prisma.project.findMany({
        where: { repoSlug },
        orderBy: { createdAt: 'desc' },
      })
      if (exact.length > 0) return exact

      // 2. Match normalizado — tolera repo privado/público, case, _ vs -
      //    ex: remote "rayzen-ai-private" resolve para repoSlug "Rayzen-AI"
      const target = normalizeSlug(repoSlug)
      const all = await this.prisma.project.findMany({ orderBy: { createdAt: 'desc' } })
      const matches = all.filter((p) => {
        if (!p.repoSlug) return false
        return normalizeSlug(p.repoSlug) === target
      })
      if (matches.length > 0) return matches

      // 3. Fallback por nome normalizado (ex: slug "rayzen-ai" ≈ nome "Rayzen AI")
      const byName = all.filter((p) => normalizeSlug(p.name) === target)
      return byName
    }
    return this.prisma.project.findMany({ orderBy: { createdAt: 'desc' } })
  }

  async findOne(id: string) {
    return this.prisma.project.findUniqueOrThrow({ where: { id } })
  }

  async create(data: { name: string; description?: string; goals?: string; repoSlug?: string }) {
    // Auto-deriva repoSlug do nome se não fornecido (ex: "Rayzen AI" → "rayzen-ai")
    const repoSlug = data.repoSlug ?? data.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
    const project = await this.prisma.project.create({ data: { ...data, repoSlug } })

    this.notion.createProjectPage(project.name)
      .then(({ id }) => this.prisma.project.update({ where: { id: project.id }, data: { notionPageId: id } }))
      .catch(() => null)

    return project
  }

  async update(id: string, data: { name?: string; description?: string; goals?: string; status?: string; notionPageId?: string; repoSlug?: string }) {
    return this.prisma.project.update({ where: { id }, data })
  }

  async delete(id: string) {
    await this.prisma.project.delete({ where: { id } })
    return { deleted: true }
  }
}
