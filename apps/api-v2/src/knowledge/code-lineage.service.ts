import { Injectable } from '@nestjs/common'
import { PrismaV2Service } from '../core/prisma-v2.service'

/**
 * Lineage real de código (AST, via graphify) — distinto do vocabulário canônico de
 * LineageService (requirement→decision→adr→module→test, que é sobre rastreabilidade
 * de requisitos, não de imports). Aqui o relation é sempre 'depende_de' entre nós
 * type:'file', sincronizado a partir de apps/agent (único lugar com acesso ao
 * graphify-out/graph.json local — esse arquivo é gitignored, nunca chega no servidor).
 */
const CODE_LINEAGE_RELATION = 'depende_de'

export interface SyncFileEntry {
  path:        string
  isRoute?:    boolean
  routePrefix?: string
}

export interface SyncEdgeEntry {
  from: string  // path
  to:   string  // path
}

export interface FileImpactNode {
  path:        string
  depth:       number
  isRoute:     boolean
  routePrefix: string | null
}

export interface FileImpactResult {
  found:          boolean
  file:           string
  impactedFiles:  FileImpactNode[]
  impactedRoutes: FileImpactNode[]
  totalImpacted:  number
}

@Injectable()
export class CodeLineageService {
  constructor(private readonly prisma: PrismaV2Service) {}

  /**
   * Substitui o lineage de código do projeto pelo snapshot enviado pelo agent.
   * Full-replace nos edges (evita staleness quando imports são removidos) — os nodes
   * são upsert por (projectId, type:'file', label:path) pra preservar o id estável.
   */
  async syncFiles(projectId: string, files: SyncFileEntry[], edges: SyncEdgeEntry[]): Promise<{ nodes: number; edges: number }> {
    const nodeIdByPath = new Map<string, string>()

    for (const f of files) {
      const existing = await this.prisma.knowledgeNode.findFirst({
        where: { projectId, type: 'file', label: f.path },
        select: { id: true },
      })

      const metadata = { isRoute: f.isRoute ?? false, routePrefix: f.routePrefix ?? null }

      const node = existing
        ? await this.prisma.knowledgeNode.update({
            where: { id: existing.id },
            data:  { metadata: metadata as object },
          })
        : await this.prisma.knowledgeNode.create({
            data: { projectId, type: 'file', label: f.path, metadata: metadata as object, origin: 'extracted' },
          })

      nodeIdByPath.set(f.path, node.id)
    }

    await this.prisma.knowledgeEdge.deleteMany({ where: { projectId, relation: CODE_LINEAGE_RELATION } })

    let edgeCount = 0
    for (const e of edges) {
      const fromId = nodeIdByPath.get(e.from)
      const toId = nodeIdByPath.get(e.to)
      if (!fromId || !toId) continue

      await this.prisma.knowledgeEdge.create({
        data: { projectId, fromId, toId, relation: CODE_LINEAGE_RELATION, source: 'extracted' },
      })
      edgeCount++
    }

    return { nodes: nodeIdByPath.size, edges: edgeCount }
  }

  /**
   * Dado um arquivo, encontra (BFS reverso) tudo que depende dele — ou seja, tudo
   * que seria impactado se esse arquivo mudasse. relation 'depende_de' vai
   * fromId→toId ("from depende_de to"), então "quem me impacta se eu mudar" é
   * quem tem uma edge ONDE toId === meu node (eles dependem de mim).
   */
  async impactFromFile(projectId: string, filePath: string, maxDepth = 5): Promise<FileImpactResult> {
    const root = await this.prisma.knowledgeNode.findFirst({
      where: { projectId, type: 'file', label: filePath },
    })

    if (!root) {
      return { found: false, file: filePath, impactedFiles: [], impactedRoutes: [], totalImpacted: 0 }
    }

    const visited = new Set<string>([root.id])
    const impacted: FileImpactNode[] = []

    let frontier = [root.id]
    for (let depth = 1; depth <= maxDepth && frontier.length > 0; depth++) {
      const incoming = await this.prisma.knowledgeEdge.findMany({
        where: { projectId, relation: CODE_LINEAGE_RELATION, toId: { in: frontier } },
        include: { from: true },
      })

      const next: string[] = []
      for (const edge of incoming) {
        if (visited.has(edge.fromId)) continue
        visited.add(edge.fromId)
        next.push(edge.fromId)

        const meta = (edge.from.metadata ?? {}) as { isRoute?: boolean; routePrefix?: string | null }
        impacted.push({
          path:        edge.from.label,
          depth,
          isRoute:     meta.isRoute ?? false,
          routePrefix: meta.routePrefix ?? null,
        })
      }
      frontier = next
    }

    return {
      found:          true,
      file:           filePath,
      impactedFiles:  impacted,
      impactedRoutes: impacted.filter((n) => n.isRoute),
      totalImpacted:  impacted.length,
    }
  }
}
