import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import { KnowledgeGraphService } from './knowledge-graph.service'

export interface UniverseNode {
  id: string
  type: string
  position: { x: number; y: number }
  data: {
    label: string
    nodeType: string
    color?: string
    originalId?: string
    [key: string]: unknown
  }
}

export interface UniverseEdge {
  id: string
  source: string
  target: string
  label?: string
  animated?: boolean
  style?: Record<string, unknown>
}

export interface UniverseMap {
  nodes: UniverseNode[]
  edges: UniverseEdge[]
}

@Injectable()
export class UniverseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly knowledge: KnowledgeGraphService,
  ) {}

  async get(projectId: string): Promise<UniverseMap> {
    const map = await this.prisma.projectKnowledgeMap.findUnique({ where: { projectId } })
    if (!map) return { nodes: [], edges: [] }
    return { nodes: map.nodes as UniverseNode[], edges: map.edges as UniverseEdge[] }
  }

  async save(projectId: string, nodes: UniverseNode[], edges: UniverseEdge[]): Promise<UniverseMap> {
    const map = await this.prisma.projectKnowledgeMap.upsert({
      where: { projectId },
      create: { projectId, nodes: nodes as object[], edges: edges as object[] },
      update: { nodes: nodes as object[], edges: edges as object[] },
    })
    return { nodes: map.nodes as UniverseNode[], edges: map.edges as UniverseEdge[] }
  }

  async importFromProject(projectId: string): Promise<UniverseMap> {
    const kg = await this.knowledge.build(projectId)

    const NODE_COLORS: Record<string, string> = {
      decision: '#6366f1',
      problem:  '#ef4444',
      idea:     '#f59e0b',
      artifact: '#06b6d4',
      document: '#10b981',
      wiki:     '#ec4899',
      goal:     '#eab308',
      file:     '#6b7280',
    }

    // Posicionar nós automaticamente em círculo por tipo
    const byType: Record<string, typeof kg.nodes> = {}
    for (const n of kg.nodes) {
      ;(byType[n.type] ??= []).push(n)
    }

    const typeOrder = ['goal', 'artifact', 'document', 'wiki', 'decision', 'idea', 'problem', 'file']
    const nodes: UniverseNode[] = []
    let colX = 0

    for (const type of typeOrder) {
      const group = byType[type] ?? []
      group.forEach((n, i) => {
        nodes.push({
          id: n.id,
          type: 'universe',
          position: { x: colX, y: i * 120 + 60 },
          data: {
            label: n.label,
            nodeType: n.type,
            color: NODE_COLORS[n.type] ?? '#6366f1',
            originalId: (n.data?.originalId as string) ?? undefined,
            ...n.data,
          },
        })
      })
      if (group.length > 0) colX += 280
    }

    const edges: UniverseEdge[] = kg.edges.map(e => ({
      id: e.id,
      source: e.source,
      target: e.target,
      label: e.label,
      animated: true,
      style: { stroke: '#ffffff20' },
    }))

    return this.save(projectId, nodes, edges)
  }
}
