import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common'
import { PrismaClient } from '@prisma/client'

// V2 nunca escreve no schema public. Apenas lê dados V1.
@Injectable()
export class V1BridgeService implements OnModuleInit, OnModuleDestroy {
  private readonly prismaV1: PrismaClient

  constructor() {
    this.prismaV1 = new PrismaClient({
      datasources: { db: { url: process.env.DATABASE_URL } },
    })
  }

  async onModuleInit() {
    await this.prismaV1.$connect()
  }

  async onModuleDestroy() {
    await this.prismaV1.$disconnect()
  }

  async getProject(id: string) {
    return this.prismaV1.project.findUnique({ where: { id } })
  }

  async getProjectState(projectId: string) {
    return this.prismaV1.projectState.findFirst({ where: { projectId } })
  }

  async getRecentEvents(projectId: string, take = 20) {
    return this.prismaV1.event.findMany({
      where: { projectId },
      orderBy: { ts: 'desc' },
      take,
      select: { id: true, type: true, source: true, content: true, ts: true, metadata: true },
    })
  }

  async getProjectGoal(projectId: string) {
    return this.prismaV1.projectGoal.findFirst({
      where: { projectId, status: { not: 'achieved' } },
      orderBy: { createdAt: 'desc' },
    })
  }

  async listProjects() {
    return this.prismaV1.project.findMany({
      where: { status: 'active' },
      select: { id: true, name: true, repoSlug: true, description: true },
      orderBy: { updatedAt: 'desc' },
    })
  }
}
