import { Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import { MemoryService } from '../memory/memory.service'

export interface CreateDataAssetDto {
  projectId?: string
  name: string
  type: 'table' | 'api' | 'file' | 'stream' | 'external'
  description?: string
  owner?: string
  sensitivity?: 'public' | 'internal' | 'confidential' | 'restricted'
  containsPII?: boolean
  piiFields?: string[]
  source?: string
  consumers?: string[]
  updateFreq?: 'real-time' | 'daily' | 'weekly' | 'manual'
  notes?: string
}

@Injectable()
export class DataCatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly memory: MemoryService,
  ) {}

  async createAsset(dto: CreateDataAssetDto) {
    const asset = await this.prisma.dataAsset.create({
      data: {
        projectId: dto.projectId ?? null,
        name: dto.name,
        type: dto.type,
        description: dto.description ?? null,
        owner: dto.owner ?? null,
        sensitivity: dto.sensitivity ?? 'internal',
        containsPII: dto.containsPII ?? false,
        piiFields: dto.piiFields ? (dto.piiFields as unknown as object[]) : undefined,
        source: dto.source ?? null,
        consumers: dto.consumers ? (dto.consumers as unknown as object[]) : undefined,
        updateFreq: dto.updateFreq ?? null,
        notes: dto.notes ?? null,
      },
    })

    // Index in pgvector for semantic search
    const text = this.buildAssetText(asset as unknown as CreateDataAssetDto & { name: string; id: string })
    this.memory.indexDocument(
      text,
      `data-catalog/asset/${asset.id}`,
      { type: 'data_asset', assetType: asset.type, sensitivity: asset.sensitivity, containsPII: String(asset.containsPII) },
      dto.projectId,
    ).catch(() => null)

    return asset
  }

  async updateAsset(id: string, dto: Partial<CreateDataAssetDto>) {
    await this.getAsset(id)
    const asset = await this.prisma.dataAsset.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.type !== undefined ? { type: dto.type } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.owner !== undefined ? { owner: dto.owner } : {}),
        ...(dto.sensitivity !== undefined ? { sensitivity: dto.sensitivity } : {}),
        ...(dto.containsPII !== undefined ? { containsPII: dto.containsPII } : {}),
        ...(dto.piiFields !== undefined ? { piiFields: dto.piiFields as unknown as object[] } : {}),
        ...(dto.source !== undefined ? { source: dto.source } : {}),
        ...(dto.consumers !== undefined ? { consumers: dto.consumers as unknown as object[] } : {}),
        ...(dto.updateFreq !== undefined ? { updateFreq: dto.updateFreq } : {}),
        ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
      },
    })

    const text = this.buildAssetText(asset as unknown as CreateDataAssetDto & { name: string; id: string })
    this.memory.indexDocument(
      text,
      `data-catalog/asset/${asset.id}`,
      { type: 'data_asset', assetType: asset.type, sensitivity: asset.sensitivity, containsPII: String(asset.containsPII) },
      dto.projectId,
    ).catch(() => null)

    return asset
  }

  async getAsset(id: string) {
    const asset = await this.prisma.dataAsset.findUnique({ where: { id } })
    if (!asset) throw new NotFoundException(`DataAsset ${id} not found`)
    return asset
  }

  async listAssets(projectId?: string, filters?: {
    type?: string
    sensitivity?: string
    containsPII?: boolean
  }) {
    return this.prisma.dataAsset.findMany({
      where: {
        ...(projectId ? { projectId } : {}),
        ...(filters?.type ? { type: filters.type } : {}),
        ...(filters?.sensitivity ? { sensitivity: filters.sensitivity } : {}),
        ...(filters?.containsPII !== undefined ? { containsPII: filters.containsPII } : {}),
      },
      orderBy: { createdAt: 'desc' },
    })
  }

  async deleteAsset(id: string) {
    await this.getAsset(id)
    return this.prisma.dataAsset.delete({ where: { id } })
  }

  // Lineage
  async addLineageEdge(sourceId: string, targetId: string, transformation?: string) {
    return this.prisma.dataLineageEdge.upsert({
      where: { sourceId_targetId: { sourceId, targetId } },
      create: { sourceId, targetId, transformation: transformation ?? null },
      update: { transformation: transformation ?? null },
    })
  }

  async getLineage(assetId: string) {
    const [upstream, downstream] = await Promise.all([
      this.prisma.dataLineageEdge.findMany({
        where: { targetId: assetId },
        include: { source: { select: { id: true, name: true, type: true } } },
      }),
      this.prisma.dataLineageEdge.findMany({
        where: { sourceId: assetId },
        include: { target: { select: { id: true, name: true, type: true } } },
      }),
    ])

    return {
      asset: await this.getAsset(assetId),
      upstream: upstream.map(e => ({ ...e.source, transformation: e.transformation })),
      downstream: downstream.map(e => ({ ...e.target, transformation: e.transformation })),
    }
  }

  async getImpact(assetId: string, visited = new Set<string>()): Promise<Array<{ id: string; name: string; type: string; depth: number }>> {
    if (visited.has(assetId)) return []
    visited.add(assetId)

    const edges = await this.prisma.dataLineageEdge.findMany({
      where: { sourceId: assetId },
      include: { target: { select: { id: true, name: true, type: true } } },
    })

    const results: Array<{ id: string; name: string; type: string; depth: number }> = []
    for (const edge of edges) {
      const depth = visited.size
      results.push({ ...edge.target, depth })
      const nested = await this.getImpact(edge.target.id, visited)
      results.push(...nested)
    }

    return results
  }

  private buildAssetText(asset: CreateDataAssetDto & { name: string; id: string }): string {
    const parts = [
      `Dataset: ${asset.name}`,
      `Tipo: ${asset.type}`,
      asset.description ? `Descrição: ${asset.description}` : '',
      asset.owner ? `Responsável: ${asset.owner}` : '',
      `Sensibilidade: ${asset.sensitivity}`,
      asset.containsPII ? `Contém dados pessoais (PII). Campos: ${(asset.piiFields as string[] | undefined)?.join(', ') ?? 'não especificado'}` : '',
      asset.source ? `Origem: ${asset.source}` : '',
      asset.consumers ? `Consumidores: ${(asset.consumers as string[]).join(', ')}` : '',
      asset.updateFreq ? `Frequência de atualização: ${asset.updateFreq}` : '',
      asset.notes ? `Notas: ${asset.notes}` : '',
    ]
    return parts.filter(Boolean).join('\n')
  }
}
