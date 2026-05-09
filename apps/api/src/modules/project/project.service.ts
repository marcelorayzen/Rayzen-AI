import { Injectable, Inject, forwardRef } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import { NotionService } from '../notion/notion.service'

@Injectable()
export class ProjectService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => NotionService)) private readonly notion: NotionService,
  ) {}

  async findAll(repoSlug?: string) {
    if (repoSlug) {
      return this.prisma.project.findMany({
        where: { repoSlug },
        orderBy: { createdAt: 'desc' },
      })
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
