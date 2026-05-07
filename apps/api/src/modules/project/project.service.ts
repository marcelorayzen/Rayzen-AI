import { Injectable, Inject, forwardRef } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import { NotionService } from '../notion/notion.service'

@Injectable()
export class ProjectService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => NotionService)) private readonly notion: NotionService,
  ) {}

  async findAll() {
    return this.prisma.project.findMany({
      orderBy: { createdAt: 'desc' },
    })
  }

  async findOne(id: string) {
    return this.prisma.project.findUniqueOrThrow({ where: { id } })
  }

  async create(data: { name: string; description?: string; goals?: string }) {
    const project = await this.prisma.project.create({ data })

    // Auto-cria página no Notion se rootPageId estiver configurado
    this.notion.createProjectPage(project.name)
      .then(({ id }) => this.prisma.project.update({ where: { id: project.id }, data: { notionPageId: id } }))
      .catch(() => null) // não bloqueia criação do projeto

    return project
  }

  async update(id: string, data: { name?: string; description?: string; goals?: string; status?: string; notionPageId?: string }) {
    return this.prisma.project.update({ where: { id }, data })
  }

  async delete(id: string) {
    await this.prisma.project.delete({ where: { id } })
    return { deleted: true }
  }
}
