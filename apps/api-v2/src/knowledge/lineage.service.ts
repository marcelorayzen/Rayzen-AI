import { Injectable } from '@nestjs/common'
import { PrismaV2Service } from '../core/prisma-v2.service'

/**
 * Vocabulário canônico de relações de lineage.
 * Direção: from → [relation] → to
 *
 *   requirement ──satisfies──▶ decision
 *   decision    ──documented_by──▶ adr
 *   adr         ──implemented_by──▶ module | file | code
 *   module/file ──validated_by──▶ test
 */
export const LINEAGE_RELATIONS = ['satisfies', 'documented_by', 'implemented_by', 'validated_by'] as const
export type  LineageRelation    = (typeof LINEAGE_RELATIONS)[number]

const LINEAGE_RELATION_SET = new Set<string>(LINEAGE_RELATIONS)

/** Classifica o tipo de nó na cadeia de lineage. */
const LINEAGE_TYPE_ORDER: Record<string, number> = {
  requirement: 0,
  decision:    1,
  adr:         2,
  module:      3,
  file:        3,
  concept:     3,
  test:        4,
}

export interface LineageNode {
  id:          string
  type:        string
  label:       string
  description: string | null
  confidence:  number
  origin:      string | null
}

export interface LineageEdge {
  id:       string
  fromId:   string
  toId:     string
  relation: LineageRelation
  weight:   number
}

export interface LineageChain {
  root:         LineageNode
  requirements: LineageNode[]
  decisions:    LineageNode[]
  adrs:         LineageNode[]
  code:         LineageNode[]  // module | file | concept
  tests:        LineageNode[]
  edges:        LineageEdge[]
  gaps:         string[]       // 'no_decision' | 'no_adr' | 'no_code' | 'no_test'
  coverageScore: number        // 0-1 (1 = chain completa até test)
}

export interface TraceResult {
  root:      LineageNode
  nodes:     LineageNode[]
  edges:     LineageEdge[]
  depth:     number
  direction: 'forward' | 'backward' | 'both'
}

export interface CoverageReport {
  projectId:           string
  total:               number
  fullyCovered:        number
  partiallyCovered:    number
  uncovered:           number
  coverageRate:        number   // 0-1
  chains:              Array<{
    requirement:  LineageNode
    gaps:         string[]
    coverageScore: number
  }>
}

@Injectable()
export class LineageService {
  constructor(private readonly prisma: PrismaV2Service) {}

  /**
   * Cria um link de lineage entre dois nós.
   * Retorna a edge criada (ou existente se já houver).
   */
  async link(fromId: string, toId: string, relation: LineageRelation, projectId: string) {
    const existing = await this.prisma.knowledgeEdge.findFirst({
      where: { fromId, toId, relation, projectId },
    })
    if (existing) return existing

    return this.prisma.knowledgeEdge.create({
      data: { projectId, fromId, toId, relation, weight: 1.0, source: 'manual' },
    })
  }

  /**
   * Trace de lineage a partir de um nó.
   * Segue apenas relações do vocabulário canônico.
   * direction='forward'  → segue outEdges (requirement → test)
   * direction='backward' → segue inEdges  (test → requirement)
   * direction='both'     → os dois sentidos
   */
  async trace(nodeId: string, direction: 'forward' | 'backward' | 'both' = 'both', maxDepth = 6): Promise<TraceResult> {
    const visited    = new Set<string>()
    const nodesMap   = new Map<string, LineageNode>()
    const edgesMap   = new Map<string, LineageEdge>()

    const load = async (id: string): Promise<LineageNode | null> => {
      const n = await this.prisma.knowledgeNode.findUnique({ where: { id } })
      if (!n) return null
      return { id: n.id, type: n.type, label: n.label, description: n.description, confidence: n.confidence, origin: n.origin }
    }

    const bfs = async (id: string, depth: number) => {
      if (depth > maxDepth || visited.has(id)) return
      visited.add(id)

      const node = await load(id)
      if (!node) return
      nodesMap.set(id, node)

      if (direction === 'forward' || direction === 'both') {
        const outEdges = await this.prisma.knowledgeEdge.findMany({
          where: { fromId: id, relation: { in: LINEAGE_RELATIONS as unknown as string[] } },
        })
        for (const e of outEdges) {
          if (!edgesMap.has(e.id)) {
            edgesMap.set(e.id, { id: e.id, fromId: e.fromId, toId: e.toId, relation: e.relation as LineageRelation, weight: e.weight })
          }
          await bfs(e.toId, depth + 1)
        }
      }

      if (direction === 'backward' || direction === 'both') {
        const inEdges = await this.prisma.knowledgeEdge.findMany({
          where: { toId: id, relation: { in: LINEAGE_RELATIONS as unknown as string[] } },
        })
        for (const e of inEdges) {
          if (!edgesMap.has(e.id)) {
            edgesMap.set(e.id, { id: e.id, fromId: e.fromId, toId: e.toId, relation: e.relation as LineageRelation, weight: e.weight })
          }
          await bfs(e.fromId, depth + 1)
        }
      }
    }

    await bfs(nodeId, 0)

    const root = nodesMap.get(nodeId) ?? (await load(nodeId))!
    const nodes = [...nodesMap.values()].filter((n) => n.id !== nodeId)
    const edges = [...edgesMap.values()]
    const depth = Math.max(0, ...nodes.map((n) => LINEAGE_TYPE_ORDER[n.type] ?? 0)) - (LINEAGE_TYPE_ORDER[root.type] ?? 0)

    return { root, nodes, edges, depth: Math.max(0, depth), direction }
  }

  /**
   * Constrói a cadeia completa de lineage a partir de um nó raiz (preferencialmente requirement).
   * Classifica cada nó visitado por tipo e identifica os gaps.
   */
  async getChain(startNodeId: string): Promise<LineageChain> {
    const result = await this.trace(startNodeId, 'forward', 8)

    const all = [result.root, ...result.nodes]
    const byType = (t: string | string[]) =>
      all.filter((n) => (Array.isArray(t) ? t.includes(n.type) : n.type === t))

    const requirements = byType('requirement')
    const decisions    = byType('decision')
    const adrs         = byType('adr')
    const code         = byType(['module', 'file', 'concept', 'flow', 'entity', 'rule'])
    const tests        = byType('test')

    const gaps: string[] = []
    if (decisions.length === 0) gaps.push('no_decision')
    if (adrs.length      === 0) gaps.push('no_adr')
    if (code.length      === 0) gaps.push('no_code')
    if (tests.length     === 0) gaps.push('no_test')

    const coverageScore = (4 - gaps.length) / 4

    return {
      root: result.root,
      requirements,
      decisions,
      adrs,
      code,
      tests,
      edges:         result.edges,
      gaps,
      coverageScore,
    }
  }

  /**
   * Relatório de cobertura de rastreabilidade do projeto.
   * Para cada nó requirement, verifica se há cadeia completa até test.
   */
  async coverage(projectId: string): Promise<CoverageReport> {
    const requirements = await this.prisma.knowledgeNode.findMany({
      where: { projectId, type: 'requirement' },
      orderBy: { label: 'asc' },
    })

    let fullyCovered = 0
    let partiallyCovered = 0
    let uncovered = 0

    const chains: CoverageReport['chains'] = []

    for (const req of requirements) {
      const chain = await this.getChain(req.id)
      const score = chain.coverageScore
      const reqNode: LineageNode = {
        id: req.id, type: req.type, label: req.label,
        description: req.description, confidence: req.confidence, origin: req.origin,
      }

      if (score >= 1)        fullyCovered++
      else if (score > 0)    partiallyCovered++
      else                   uncovered++

      chains.push({ requirement: reqNode, gaps: chain.gaps, coverageScore: score })
    }

    const total = requirements.length
    return {
      projectId,
      total,
      fullyCovered,
      partiallyCovered,
      uncovered,
      coverageRate: total > 0 ? fullyCovered / total : 0,
      chains,
    }
  }

  /** Lista todas as relações de lineage existentes num projeto. */
  async listLinks(projectId: string) {
    const edges = await this.prisma.knowledgeEdge.findMany({
      where: { projectId, relation: { in: LINEAGE_RELATIONS as unknown as string[] } },
      orderBy: { createdAt: 'desc' },
    })

    const nodeIds = [...new Set([...edges.map((e) => e.fromId), ...edges.map((e) => e.toId)])]
    const nodes   = await this.prisma.knowledgeNode.findMany({ where: { id: { in: nodeIds } } })
    const nodeMap = new Map(nodes.map((n) => [n.id, n]))

    return edges.map((e) => ({
      id:       e.id,
      relation: e.relation,
      from: nodeMap.get(e.fromId),
      to:   nodeMap.get(e.toId),
    }))
  }
}
