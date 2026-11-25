import {
  BadRequestException, ConflictException, ForbiddenException, Injectable,
  Logger, NotFoundException, OnModuleInit,
} from '@nestjs/common'
import { createHash } from 'crypto'
import { Prisma } from '../../generated/prisma-client-v2'
import { PrismaV2Service } from '../core/prisma-v2.service'
import { V1ApiService } from '../core/v1-api.service'
import { KnowledgeRevisionService } from '../core/knowledge-revision.service'
import { ehDonoDoConhecimento } from '../core/knowledge-owner.const'
import type { AuthPrincipal } from '../core/auth.guard'
import {
  CreateKnowledgeProposalDto, KnowledgeDecisionDto, ListKnowledgeProposalDto,
} from './dto/knowledge.dto'
import { hashDoPayloadDeCaptura, namespaceDoPrincipal } from './captura-idempotente.const'

@Injectable()
export class KnowledgeGovernanceService implements OnModuleInit {
  private readonly logger = new Logger(KnowledgeGovernanceService.name)

  constructor(
    private readonly prisma: PrismaV2Service,
    private readonly v1Api: V1ApiService,
    private readonly revisions: KnowledgeRevisionService,
  ) {}

  async onModuleInit() {
    // `db push` cria as tabelas, mas não representa triggers. A imutabilidade da
    // evidência é instalada no boot e falha o startup se o banco não puder garanti-la.
    await this.prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION v2.reject_knowledge_source_mutation()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        RAISE EXCEPTION 'knowledge_sources are immutable';
      END;
      $$
    `)
    await this.prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS knowledge_sources_immutable ON v2.knowledge_sources')
    await this.prisma.$executeRawUnsafe(`
      CREATE TRIGGER knowledge_sources_immutable
      BEFORE UPDATE OR DELETE ON v2.knowledge_sources
      FOR EACH ROW EXECUTE FUNCTION v2.reject_knowledge_source_mutation()
    `)
    await this.prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION v2.reject_knowledge_decision_mutation()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        RAISE EXCEPTION 'knowledge_decisions are append-only';
      END;
      $$
    `)
    await this.prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS knowledge_decisions_append_only ON v2.knowledge_decisions')
    await this.prisma.$executeRawUnsafe(`
      CREATE TRIGGER knowledge_decisions_append_only
      BEFORE UPDATE OR DELETE ON v2.knowledge_decisions
      FOR EACH ROW EXECUTE FUNCTION v2.reject_knowledge_decision_mutation()
    `)
  }

  async createProposal(dto: CreateKnowledgeProposalDto, principal: AuthPrincipal) {
    const scopeKey = this.scopeKey(dto.scopeType, dto.projectId)
    const rawContent = dto.sourceContent ?? dto.content
    const sourceHash = hash(rawContent)
    const contentHash = hash(dto.content)
    const namespace = namespaceDoPrincipal(principal)
    const payloadHash = hashDoPayloadDeCaptura(dto)

    // A chave é conferida ANTES de qualquer escrita, e fora da transação de propósito:
    // uma requisição repetida não precisa tocar a fonte imutável para descobrir que já
    // foi atendida.
    const jaVisto = await this.propostaDaChave(namespace, dto.idempotencyKey)
    if (jaVisto) return this.replayOuConflito(jaVisto, payloadHash, dto.idempotencyKey)

    try {
      return await this.criar(dto, principal, { scopeKey, rawContent, sourceHash, contentHash, namespace, payloadHash })
    } catch (error) {
      // Duas requisições com a mesma chave chegando juntas passam as duas pela conferência
      // acima e disputam o índice único. Quem perde a corrida resolve pela MESMA regra da
      // conferência — replay se o payload bate, 409 se não — em vez de devolver um erro de
      // banco. Sem isto, a retentativa concorrente do produtor viraria HTTP 500 no caminho
      // que a idempotência existe justamente para tornar seguro.
      if (!ehColisaoDeChave(error)) throw error
      const concorrente = await this.propostaDaChave(namespace, dto.idempotencyKey)
      if (!concorrente) throw error
      return this.replayOuConflito(concorrente, payloadHash, dto.idempotencyKey)
    }
  }

  private criar(
    dto: CreateKnowledgeProposalDto,
    principal: AuthPrincipal,
    derivados: {
      scopeKey: string; rawContent: string; sourceHash: string
      contentHash: string; namespace: string; payloadHash: string
    },
  ) {
    const { scopeKey, rawContent, sourceHash, contentHash, namespace, payloadHash } = derivados
    return this.prisma.$transaction(async (tx) => {
      await tx.knowledgeSource.createMany({
        data: [{
          scopeKey,
          scopeType: dto.scopeType,
          projectId: dto.projectId,
          sourceType: dto.sourceType,
          sourceIdentity: dto.sourceIdentity,
          sourceHash,
          rawContent,
          metadata: (dto.metadata ?? {}) as Prisma.InputJsonValue,
          retentionPolicy: dto.retentionPolicy ?? 'indefinite',
          retainUntil: dto.retainUntil ? new Date(dto.retainUntil) : undefined,
          capturedBy: principal.subject,
        }],
        skipDuplicates: true,
      })
      const source = await tx.knowledgeSource.findUnique({
        where: {
          scopeKey_sourceIdentity_sourceHash: {
            scopeKey,
            sourceIdentity: dto.sourceIdentity,
            sourceHash,
          },
        },
      })
      if (!source) throw new ConflictException('Could not persist immutable knowledge source')

      // Dedupe da Fase 2: a mesma revisão da mesma fonte, com o mesmo conteúdo, é a mesma
      // captura mesmo sob uma chave nova.
      //
      // Limite declarado: a chave nova **não** fica registrada, porque a linha devolvida já
      // nasceu com a chave da captura original e uma linha carrega uma chave só. Na prática
      // isso significa que uma chave usada pela primeira vez num pedido que caiu aqui pode,
      // depois, ser reusada com outro payload sem receber 409. O caso normal — a chave
      // criou a linha — é coberto, e é onde o reuso indevido acontece.
      const duplicate = await tx.knowledgeProposal.findUnique({
        where: {
          sourceId_logicalKey_contentHash: {
            sourceId: source.id,
            logicalKey: dto.logicalKey,
            contentHash,
          },
        },
        include: { source: true },
      })
      if (duplicate) return duplicate

      const latest = await tx.knowledgeProposal.findFirst({
        where: { scopeKey, logicalKey: dto.logicalKey },
        orderBy: { version: 'desc' },
        select: { version: true },
      })
      const active = await tx.knowledgeVersion.findFirst({
        where: { scopeKey, logicalKey: dto.logicalKey, status: 'active' },
        select: { proposalId: true },
      })

      return tx.knowledgeProposal.create({
        data: {
          sourceId: source.id,
          scopeKey,
          projectId: dto.projectId,
          logicalKey: dto.logicalKey,
          namespace,
          idempotencyKey: dto.idempotencyKey,
          payloadHash,
          version: (latest?.version ?? 0) + 1,
          content: dto.content,
          contentHash,
          knowledgeType: dto.knowledgeType,
          sensitivity: dto.sensitivity ?? 'internal',
          retentionPolicy: dto.retentionPolicy ?? 'indefinite',
          retainUntil: dto.retainUntil ? new Date(dto.retainUntil) : undefined,
          validFrom: dto.validFrom ? new Date(dto.validFrom) : undefined,
          validUntil: dto.validUntil ? new Date(dto.validUntil) : undefined,
          producer: dto.producer,
          producerVersion: dto.producerVersion,
          supersedesId: active?.proposalId,
          createdBy: principal.subject,
        },
        include: { source: true },
      })
    })
  }

  private propostaDaChave(namespace: string, idempotencyKey: string) {
    return this.prisma.knowledgeProposal.findUnique({
      where: { namespace_idempotencyKey: { namespace, idempotencyKey } },
      include: { source: true },
    })
  }

  /**
   * A mesma chave com o mesmo payload é a mesma captura; com outro payload é um erro do
   * produtor, e um erro que **não pode** ser resolvido escolhendo um dos dois.
   *
   * Atender o segundo payload apagaria silenciosamente o primeiro; ignorá-lo devolveria
   * HTTP 200 para um conteúdo que nunca entrou. As duas saídas mentem, e nenhuma deixa
   * rastro. O 409 devolve a decisão a quem tem a informação para decidir.
   */
  private replayOuConflito<T extends { payloadHash: string | null }>(
    existente: T,
    payloadHash: string,
    idempotencyKey: string,
  ): T & { replay: true } {
    if (existente.payloadHash !== payloadHash) {
      throw new ConflictException(
        `Idempotency key ${idempotencyKey} was already used with a different payload`,
      )
    }
    return { ...existente, replay: true }
  }

  listProposals(query: ListKnowledgeProposalDto) {
    const scopeKey = query.scopeType
      ? this.scopeKey(query.scopeType, query.projectId)
      : undefined
    return this.prisma.knowledgeProposal.findMany({
      where: {
        ...(scopeKey ? { scopeKey } : {}),
        ...(query.projectId && !scopeKey ? { projectId: query.projectId } : {}),
        ...(query.status ? { status: query.status } : {}),
      },
      include: { source: true, decisions: { orderBy: { decidedAt: 'asc' } }, canonical: true },
      orderBy: { createdAt: 'desc' },
      take: 100,
    })
  }

  listCanonical(scopeType: 'personal' | 'project', projectId?: string) {
    const scopeKey = this.scopeKey(scopeType, projectId)
    return this.prisma.knowledgeVersion.findMany({
      where: { scopeKey },
      include: { proposal: { include: { source: true } }, projections: true },
      orderBy: [{ logicalKey: 'asc' }, { version: 'desc' }],
    })
  }

  async approve(id: string, dto: KnowledgeDecisionDto, principal: AuthPrincipal) {
    this.assertOwner(principal)

    const result = await this.prisma.$transaction(async (tx) => {
      const proposal = await tx.knowledgeProposal.findUnique({
        where: { id },
        include: { source: true, canonical: { include: { projections: true } } },
      })
      if (!proposal) throw new NotFoundException('Knowledge proposal not found')
      if (proposal.status === 'approved' && proposal.canonical) {
        return { proposal, canonical: proposal.canonical, replay: true }
      }
      if (proposal.status !== 'candidate') {
        throw new ConflictException(`Proposal is ${proposal.status}, not candidate`)
      }

      const previous = await tx.knowledgeVersion.findFirst({
        where: { scopeKey: proposal.scopeKey, logicalKey: proposal.logicalKey, status: 'active' },
        select: { id: true, proposalId: true },
      })

      if (previous) {
        await tx.knowledgeVersion.update({ where: { id: previous.id }, data: { status: 'superseded' } })
        await tx.knowledgeProjection.updateMany({
          where: { knowledgeVersionId: previous.id },
          data: { status: 'stale' },
        })
        await tx.knowledgeProposal.update({
          where: { id: previous.proposalId },
          data: { status: 'superseded' },
        })
      }

      const approved = await tx.knowledgeProposal.update({
        where: { id },
        data: { status: 'approved' },
        include: { source: true },
      })
      await tx.knowledgeDecision.create({
        data: {
          proposalId: id,
          action: 'approve',
          actorSubject: principal.subject,
          actorRole: principal.role,
          reason: dto.reason,
          proposalVersion: approved.version,
          contentHash: approved.contentHash,
        },
      })
      const canonical = await tx.knowledgeVersion.create({
        data: {
          proposalId: id,
          sourceId: approved.sourceId,
          scopeKey: approved.scopeKey,
          projectId: approved.projectId,
          logicalKey: approved.logicalKey,
          version: approved.version,
          content: approved.content,
          contentHash: approved.contentHash,
          knowledgeType: approved.knowledgeType,
          retentionPolicy: approved.retentionPolicy,
          retainUntil: approved.retainUntil,
          validFrom: approved.validFrom,
          validUntil: approved.validUntil,
          approvedBy: principal.subject,
          ...(approved.projectId ? {
            projections: {
              create: { kind: 'vector', contentHash: approved.contentHash, status: 'pending' },
            },
          } : {}),
        },
        include: { projections: true },
      })
      return { proposal: approved, canonical, replay: false }
    })

    if (result.replay) return result

    let canonical = result.canonical
    if (result.proposal.projectId) canonical = await this.buildVectorProjection(canonical.id)
    this.revisions.bump(result.proposal.scopeKey)
    return { ...result, canonical }
  }

  async reject(id: string, dto: KnowledgeDecisionDto, principal: AuthPrincipal) {
    this.assertOwner(principal)
    const rejected = await this.prisma.$transaction(async (tx) => {
      const proposal = await tx.knowledgeProposal.findUnique({ where: { id } })
      if (!proposal) throw new NotFoundException('Knowledge proposal not found')
      if (proposal.status === 'rejected') return proposal
      if (proposal.status !== 'candidate') {
        throw new ConflictException(`Proposal is ${proposal.status}, not candidate`)
      }
      const updated = await tx.knowledgeProposal.update({ where: { id }, data: { status: 'rejected' } })
      await tx.knowledgeDecision.create({
        data: {
          proposalId: id,
          action: 'reject',
          actorSubject: principal.subject,
          actorRole: principal.role,
          reason: dto.reason,
          proposalVersion: updated.version,
          contentHash: updated.contentHash,
        },
      })
      return updated
    })
    this.revisions.bump(rejected.scopeKey)
    return rejected
  }

  async rebuildVectorProjection(knowledgeVersionId: string) {
    const knowledge = await this.prisma.knowledgeVersion.findUnique({ where: { id: knowledgeVersionId } })
    if (!knowledge) throw new NotFoundException('Knowledge version not found')
    if (knowledge.status !== 'active') throw new ConflictException('Only active knowledge can be projected')
    if (!knowledge.projectId) throw new BadRequestException('Personal knowledge has no project vector projection')
    const rebuilt = await this.buildVectorProjection(knowledgeVersionId)
    this.revisions.bump(knowledge.scopeKey)
    return rebuilt
  }

  private async buildVectorProjection(knowledgeVersionId: string) {
    const knowledge = await this.prisma.knowledgeVersion.findUnique({
      where: { id: knowledgeVersionId },
      include: { proposal: { include: { source: true } }, projections: true },
    })
    if (!knowledge?.projectId) throw new BadRequestException('Project-scoped knowledge required')

    await this.prisma.knowledgeProjection.upsert({
      where: { knowledgeVersionId_kind: { knowledgeVersionId, kind: 'vector' } },
      create: { knowledgeVersionId, kind: 'vector', contentHash: knowledge.contentHash, status: 'pending' },
      update: { status: 'pending', error: null },
    })

    try {
      const indexed = await this.v1Api.indexContent({
        projectId: knowledge.projectId,
        content: knowledge.content,
        sourcePath: `knowledge://${knowledge.scopeKey}/${knowledge.logicalKey}/v${knowledge.version}`,
        sourceType: 'approved_knowledge',
        metadata: {
          knowledgeVersionId: knowledge.id,
          proposalId: knowledge.proposalId,
          sourceId: knowledge.sourceId,
          sourceIdentity: knowledge.proposal.source.sourceIdentity,
          lifecycle: 'approved',
          version: knowledge.version,
          approvedAt: knowledge.approvedAt.toISOString(),
        },
      })
      return await this.prisma.knowledgeVersion.update({
        where: { id: knowledgeVersionId },
        data: {
          projections: {
            update: {
              where: { knowledgeVersionId_kind: { knowledgeVersionId, kind: 'vector' } },
              data: {
                status: indexed.id ? 'ready' : 'failed',
                externalId: indexed.id,
                error: indexed.id ? null : 'V1 index returned no document id',
                builtAt: indexed.id ? new Date() : null,
              },
            },
          },
        },
        include: { projections: true },
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await this.prisma.knowledgeProjection.update({
        where: { knowledgeVersionId_kind: { knowledgeVersionId, kind: 'vector' } },
        data: { status: 'failed', error: message },
      })
      this.logger.warn(`Vector projection failed for ${knowledgeVersionId}: ${message}`)
      const failed = await this.prisma.knowledgeVersion.findUnique({
        where: { id: knowledgeVersionId },
        include: { projections: true },
      })
      if (!failed) throw new NotFoundException('Knowledge version disappeared after projection failure')
      return failed
    }
  }

  private assertOwner(principal: AuthPrincipal) {
    if (!ehDonoDoConhecimento(principal)) {
      throw new ForbiddenException('Only the authenticated knowledge owner can decide proposals')
    }
  }

  private scopeKey(scopeType: 'personal' | 'project', projectId?: string): string {
    if (scopeType === 'personal') {
      if (projectId) throw new BadRequestException('Personal scope cannot include projectId')
      return 'personal'
    }
    if (!projectId) throw new BadRequestException('projectId is required for project scope')
    return `project:${projectId}`
  }
}

function hash(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

/**
 * Só a colisão do PAR (namespace, chave) é tratada como corrida.
 *
 * `knowledge_proposals` tem outros índices únicos — versão por escopo, conteúdo por fonte.
 * Tratar qualquer P2002 como "alguém chegou antes com a mesma chave" faria a releitura
 * devolver `null` e o erro original ser relançado no melhor caso; no pior, devolveria como
 * replay uma linha que não tem nada a ver com esta captura.
 */
function ehColisaoDeChave(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') return false
  const alvo = error.meta?.target
  const campos = Array.isArray(alvo) ? alvo.map(String) : [String(alvo ?? '')]
  return campos.some((campo) => campo.includes('idempotency_key') || campo === 'idempotencyKey')
}
