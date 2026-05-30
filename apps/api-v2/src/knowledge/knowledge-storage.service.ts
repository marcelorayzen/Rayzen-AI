import { Injectable } from '@nestjs/common'
import { PrismaV2Service } from '../core/prisma-v2.service'

export type EntityType = 'module' | 'rule' | 'entity' | 'adr' | 'flow' | 'file' | 'concept'

export interface CreateNodeDto {
  projectId:    string
  type:         EntityType
  label:        string
  description?: string
  metadata?:    Record<string, unknown>
}

export interface CreateEdgeDto {
  projectId: string
  fromId:    string
  toId:      string
  relation:  string
  weight?:   number
  source?:   'extracted' | 'manual' | 'inferred'
}

@Injectable()
export class KnowledgeStorageService {
  constructor(private readonly prisma: PrismaV2Service) {}

  async upsertNode(dto: CreateNodeDto) {
    const existing = await this.prisma.knowledgeNode.findFirst({
      where: { projectId: dto.projectId, label: dto.label, type: dto.type },
    })
    if (existing) {
      return this.prisma.knowledgeNode.update({
        where: { id: existing.id },
        data: {
          description: dto.description ?? existing.description,
          metadata:    (dto.metadata ?? {}) as object,
          updatedAt:   new Date(),
        },
      })
    }
    return this.prisma.knowledgeNode.create({
      data: {
        projectId:   dto.projectId,
        type:        dto.type,
        label:       dto.label,
        description: dto.description,
        metadata:    (dto.metadata ?? {}) as object,
      },
    })
  }

  async upsertEdge(dto: CreateEdgeDto) {
    const existing = await this.prisma.knowledgeEdge.findFirst({
      where: { projectId: dto.projectId, fromId: dto.fromId, toId: dto.toId, relation: dto.relation },
    })
    if (existing) return existing
    return this.prisma.knowledgeEdge.create({
      data: {
        projectId: dto.projectId,
        fromId:    dto.fromId,
        toId:      dto.toId,
        relation:  dto.relation,
        weight:    dto.weight ?? 1.0,
        source:    dto.source ?? 'extracted',
      },
    })
  }

  async getNode(id: string) {
    return this.prisma.knowledgeNode.findUnique({
      where: { id },
      include: { outEdges: { include: { to: true } }, inEdges: { include: { from: true } } },
    })
  }

  async listNodes(projectId: string, type?: EntityType) {
    return this.prisma.knowledgeNode.findMany({
      where: { projectId, ...(type ? { type } : {}) },
      include: { outEdges: true, inEdges: true },
      orderBy: { label: 'asc' },
    })
  }

  async deleteNode(id: string) {
    return this.prisma.knowledgeNode.delete({ where: { id } })
  }

  async getGraph(projectId: string) {
    const nodes = await this.prisma.knowledgeNode.findMany({ where: { projectId } })
    const edges = await this.prisma.knowledgeEdge.findMany({ where: { projectId } })
    return { nodes, edges, nodeCount: nodes.length, edgeCount: edges.length }
  }
}
