import { Injectable } from '@nestjs/common'
import { PrismaV2Service } from '../core/prisma-v2.service'

export interface GraphQuery {
  projectId:    string
  startLabel?:  string
  startId?:     string
  relations?:   string[]
  depth?:       number
  entityTypes?: string[]
}

export interface GraphSubset {
  nodes: Array<{ id: string; type: string; label: string; description?: string | null }>
  edges: Array<{ id: string; fromId: string; toId: string; relation: string; weight: number }>
  startId?: string
}

@Injectable()
export class KnowledgeQueryService {
  constructor(private readonly prisma: PrismaV2Service) {}

  async query(q: GraphQuery): Promise<GraphSubset> {
    const depth     = Math.min(q.depth ?? 2, 4)
    const projectId = q.projectId

    // Find start node
    let startId = q.startId
    if (!startId && q.startLabel) {
      const node = await this.prisma.knowledgeNode.findFirst({
        where: { projectId, label: { contains: q.startLabel, mode: 'insensitive' } },
      })
      startId = node?.id
    }

    if (!startId) {
      // No start — return full graph (limited)
      const nodes = await this.prisma.knowledgeNode.findMany({
        where: { projectId, ...(q.entityTypes?.length ? { type: { in: q.entityTypes } } : {}) },
        take: 100,
      })
      const nodeIds = nodes.map((n) => n.id)
      const edges = await this.prisma.knowledgeEdge.findMany({
        where: {
          projectId,
          fromId: { in: nodeIds },
          ...(q.relations?.length ? { relation: { in: q.relations } } : {}),
        },
        take: 200,
      })
      return {
        nodes: nodes.map((n) => ({ id: n.id, type: n.type, label: n.label, description: n.description })),
        edges: edges.map((e) => ({ id: e.id, fromId: e.fromId, toId: e.toId, relation: e.relation, weight: e.weight })),
      }
    }

    // BFS traversal
    const visitedIds  = new Set<string>([startId])
    const edgesSeen   = new Set<string>()
    const resultEdges: typeof allEdges = []
    let   frontier    = [startId]
    const allEdges: Array<{ id: string; fromId: string; toId: string; relation: string; weight: number }> = []

    for (let d = 0; d < depth && frontier.length > 0; d++) {
      const edges = await this.prisma.knowledgeEdge.findMany({
        where: {
          projectId,
          fromId: { in: frontier },
          ...(q.relations?.length ? { relation: { in: q.relations } } : {}),
        },
      })
      const nextFrontier: string[] = []
      for (const e of edges) {
        if (!edgesSeen.has(e.id)) {
          edgesSeen.add(e.id)
          resultEdges.push({ id: e.id, fromId: e.fromId, toId: e.toId, relation: e.relation, weight: e.weight })
        }
        if (!visitedIds.has(e.toId)) {
          visitedIds.add(e.toId)
          nextFrontier.push(e.toId)
        }
      }
      frontier = nextFrontier
    }
    void allEdges

    const allNodeIds = [...visitedIds]
    const nodes = await this.prisma.knowledgeNode.findMany({
      where: { id: { in: allNodeIds }, ...(q.entityTypes?.length ? { type: { in: q.entityTypes } } : {}) },
    })

    return {
      nodes:   nodes.map((n) => ({ id: n.id, type: n.type, label: n.label, description: n.description })),
      edges:   resultEdges,
      startId,
    }
  }
}
