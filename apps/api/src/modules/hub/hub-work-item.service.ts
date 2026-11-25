import {
  BadRequestException, ConflictException, Injectable, NotFoundException, Optional, ServiceUnavailableException,
} from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import { ExecutionService } from '../execution/execution.service'
import { HubThreadService } from './hub-thread.service'

/** O que o cartão de entrega do Hub mostra (item 7.2a, fatia C). */
export interface EntregaPublica {
  branch: string
  commit: string
  publicado: boolean
  prUrl: string | null
  prEstado: string | null
  prRascunho: boolean | null
  medidoEm: string | null
}

const PR_GITHUB = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+$/

/**
 * Reduz `ProjectHandoff.delivery` ao que o navegador precisa — e nada além.
 *
 * `remoto` fica DE FORA de propósito: uma URL de remoto pode carregar credencial embutida
 * (`https://usuario:token@github.com/...`), e o cartão não precisa dela. Link de PR só passa se
 * for de PR no GitHub: o valor veio de uma medição do agent, mas o navegador vai abri-lo como
 * link, e `javascript:` ou outro host não têm por que chegar lá.
 */
export function entregaPublica(bruto: unknown): EntregaPublica | null {
  if (!bruto || typeof bruto !== 'object') return null
  const d = bruto as Record<string, unknown>
  if (typeof d.branch !== 'string' || typeof d.commit !== 'string') return null
  const prUrl = typeof d.prUrl === 'string' && PR_GITHUB.test(d.prUrl) ? d.prUrl : null
  return {
    branch: d.branch,
    commit: d.commit,
    publicado: d.publicado === true,
    prUrl,
    prEstado: typeof d.prEstado === 'string' ? d.prEstado : null,
    prRascunho: typeof d.prRascunho === 'boolean' ? d.prRascunho : null,
    medidoEm: typeof d.medidoEm === 'string' ? d.medidoEm : null,
  }
}

@Injectable()
export class HubWorkItemService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly threads: HubThreadService,
    @Optional() private readonly execution?: ExecutionService,
  ) {}

  /**
   * "Abrir na minha máquina" (item 7.2a, fatia D).
   *
   * Parte do ITEM DO FIO, nunca de um branch vindo do navegador: o cliente só diz qual cartão
   * clicou, e o branch sai da entrega que o servidor confirmou e gravou. Um corpo com
   * `branch: "main"` não tem como chegar ao agent por aqui — e, se chegasse, o agent recusa.
   *
   * Só envelope `completed` com entrega: abrir o que ainda não foi verificado mostraria trabalho
   * não confirmado com a mesma cara do confirmado.
   */
  async abrirEntrega(principalId: string, projectId: string, itemId: string) {
    if (!this.execution) throw new ServiceUnavailableException({ code: 'hub_execution_unavailable' })
    const thread = await this.threads.resolveActive(principalId, projectId)
    const item = await (this.prisma as any).hubWorkItem.findFirst({
      where: { id: itemId, threadId: thread.id, kind: 'project_handoff', sourceSystem: 'v1' },
    })
    if (!item) throw new NotFoundException({ code: 'hub_work_item_not_found' })
    const handoff = await (this.prisma as any).projectHandoff.findFirst({
      where: { id: item.sourceId, sourceProjectId: projectId },
      select: { id: true, status: true, projectId: true, delivery: true },
    })
    const entrega = handoff ? entregaPublica(handoff.delivery) : null
    if (!handoff || handoff.status !== 'completed' || !entrega) {
      throw new ConflictException({ code: 'hub_delivery_unavailable' })
    }
    return this.execution.dispatch('open_delivery', {
      projectId: handoff.projectId ?? projectId,
      branch: entrega.branch,
    })
  }

  async list(principalId: string, projectId?: string) {
    const thread = await this.threads.resolveActive(principalId, projectId ?? null)
    return (this.prisma as any).hubWorkItem.findMany({
      where: { threadId: thread.id }, orderBy: { createdAt: 'desc' }, take: 100,
    })
  }

  async link(principalId: string, projectId: string | undefined, input: { kind: string; sourceSystem: string; sourceId: string }) {
    if (!projectId) throw new BadRequestException({ code: 'hub_project_required' })
    if (input.kind !== 'project_handoff' || input.sourceSystem !== 'v1') {
      throw new BadRequestException({ code: 'hub_work_item_source_unsupported' })
    }
    const handoff = await (this.prisma as any).projectHandoff.findFirst({
      where: { id: input.sourceId, sourceProjectId: projectId }, select: { id: true },
    })
    if (!handoff) throw new NotFoundException({ code: 'hub_handoff_not_found' })
    const thread = await this.threads.resolveActive(principalId, projectId ?? null)
    return (this.prisma as any).hubWorkItem.upsert({
      where: { threadId_sourceSystem_sourceId: { threadId: thread.id, sourceSystem: input.sourceSystem, sourceId: input.sourceId } },
      create: { threadId: thread.id, kind: input.kind, sourceSystem: input.sourceSystem, sourceId: input.sourceId },
      update: {},
    })
  }

  async unlinkedHandoffs(projectId: string) {
    const linked = await (this.prisma as any).hubWorkItem.findMany({
      where: { sourceSystem: 'v1', kind: 'project_handoff' }, select: { sourceId: true },
    })
    return (this.prisma as any).projectHandoff.findMany({
      where: { sourceProjectId: projectId, id: { notIn: linked.map((item: { sourceId: string }) => item.sourceId) } },
      select: { id: true, name: true, status: true, createdAt: true, updatedAt: true }, orderBy: { createdAt: 'desc' }, take: 100,
    })
  }

  /** The current status remains owned by ProjectHandoff V1; this is only a Hub projection. */
  async linkedHandoffs(principalId: string, projectId: string) {
    const thread = await this.threads.resolveActive(principalId, projectId)
    const items = await (this.prisma as any).hubWorkItem.findMany({
      where: { threadId: thread.id, sourceSystem: 'v1', kind: 'project_handoff' },
      orderBy: { createdAt: 'desc' }, take: 100,
    })
    if (!items.length) return []

    const handoffs = await (this.prisma as any).projectHandoff.findMany({
      where: { sourceProjectId: projectId, id: { in: items.map((item: { sourceId: string }) => item.sourceId) } },
      select: { id: true, name: true, status: true, createdAt: true, updatedAt: true, delivery: true },
    })
    const byId = new Map(handoffs.map(({ delivery, ...handoff }: { id: string; delivery?: unknown }) => [
      handoff.id, { ...handoff, entrega: entregaPublica(delivery) },
    ]))
    return items.map((item: { id: string; sourceId: string; createdAt: Date }) => ({
      id: item.id,
      sourceId: item.sourceId,
      linkedAt: item.createdAt,
      handoff: byId.get(item.sourceId) ?? null,
    }))
  }
}
