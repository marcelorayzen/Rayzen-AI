import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'

@Injectable()
export class ProjectService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll() {
    return this.prisma.project.findMany({
      orderBy: { createdAt: 'desc' },
    })
  }

  async findOne(id: string) {
    return this.prisma.project.findUniqueOrThrow({ where: { id } })
  }

  async create(data: { name: string; description?: string; goals?: string }) {
    return this.prisma.project.create({ data })
  }

  async update(id: string, data: { name?: string; description?: string; goals?: string; status?: string }) {
    return this.prisma.project.update({ where: { id }, data })
  }

  async delete(id: string) {
    await this.prisma.project.delete({ where: { id } })
    return { deleted: true }
  }
}
