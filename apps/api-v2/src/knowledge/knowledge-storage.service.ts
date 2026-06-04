import { Injectable, ForbiddenException } from '@nestjs/common'
import { PrismaV2Service } from '../core/prisma-v2.service'
import { KnowledgeGovernanceService, KnowledgeOrigin } from './knowledge-governance.service'
import { PolicyEngineService } from '../policy-engine/policy-engine.service'

export type EntityType =
  | 'module' | 'rule' | 'entity' | 'adr' | 'flow' | 'file' | 'concept'
  | 'requirement' | 'decision' | 'test'

export interface CreateNodeDto {
  projectId:    string
  type:         EntityType
  label:        string
  description?: string
  metadata?:    Record<string, unknown>
  origin?:      KnowledgeOrigin
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
  constructor(
    private readonly prisma:      PrismaV2Service,
    private readonly governance:  KnowledgeGovernanceService,
    private readonly policyEngine: PolicyEngineService,
  ) {}

  async upsertNode(dto: CreateNodeDto) {
    // ECC: verifica consistência antes de persistir
    const gov = await this.governance.check({
      projectId:   dto.projectId,
      label:       dto.label,
      type:        dto.type,
      description: dto.description,
      origin:      dto.origin,
    })

    // Policy Engine: verifica regras de governança
    const policy = await this.policyEngine.evaluate({
      operation: 'knowledge_add',
      projectId: dto.projectId,
      data: {
        origin:     dto.origin,
        trustScore: gov.trustScore,
        label:      dto.label,
        type:       dto.type,
      },
    })

    if (!policy.allowed) {
      const reason = policy.violations.map((v) => v.message).join('; ')
      throw new ForbiddenException(`PolicyEngine bloqueou a operação: ${reason}`)
    }

    // Enriquece metadata com resultado do ECC + avisos de política + gate info
    const eccMeta = gov.hasConflict
      ? { conflict: true, conflictDetail: gov.conflictDetail, checkedAt: new Date().toISOString() }
      : undefined

    const policyWarnings = policy.warnings.length > 0
      ? policy.warnings.map((w) => ({ rule: w.rule, message: w.message }))
      : undefined

    const gateInfo = policy.gateRequired
      ? { required: true, gateId: policy.gateId, rules: policy.gateViolations.map((v) => v.rule) }
      : undefined

    const metadata = {
      ...(dto.metadata ?? {}),
      ...(eccMeta         ? { ecc: eccMeta } : {}),
      ...(policyWarnings  ? { policyWarnings } : {}),
      ...(gateInfo        ? { gate: gateInfo } : {}),
    }

    const existing = gov.existingNodeId
      ? await this.prisma.knowledgeNode.findUnique({ where: { id: gov.existingNodeId } })
      : null

    if (existing) {
      return this.prisma.knowledgeNode.update({
        where: { id: existing.id },
        data: {
          description: dto.description ?? existing.description,
          metadata:    metadata as object,
          confidence:  gov.trustScore,
          origin:      dto.origin ?? existing.origin ?? undefined,
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
        metadata:    metadata as object,
        confidence:  gov.trustScore,
        origin:      dto.origin ?? null,
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
