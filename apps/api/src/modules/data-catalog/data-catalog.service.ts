import { Injectable, Logger, NotFoundException } from '@nestjs/common'
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
  private readonly logger = new Logger(DataCatalogService.name)

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

    const text = this.buildAssetText(asset as unknown as CreateDataAssetDto & { name: string; id: string })
    this.memory.indexDocument(
      text,
      `data-catalog/asset/${asset.id}`,
      { type: 'data_asset', assetType: asset.type, sensitivity: asset.sensitivity, containsPII: String(asset.containsPII) },
      dto.projectId,
    ).catch(err => this.logger.warn(`Failed to index asset ${asset.id}: ${(err as Error).message}`))

    return asset
  }

  async updateAsset(id: string, dto: Partial<CreateDataAssetDto>) {
    const existing = await this.getAsset(id)
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

    // Use asset's own projectId (not DTO) to ensure consistent scoping
    const projectId = (existing as unknown as { projectId: string | null }).projectId ?? dto.projectId
    const text = this.buildAssetText(asset as unknown as CreateDataAssetDto & { name: string; id: string })
    this.memory.indexDocument(
      text,
      `data-catalog/asset/${asset.id}`,
      { type: 'data_asset', assetType: asset.type, sensitivity: asset.sensitivity, containsPII: String(asset.containsPII) },
      projectId ?? undefined,
    ).catch(err => this.logger.warn(`Failed to re-index asset ${asset.id}: ${(err as Error).message}`))

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
    // Clean up indexed documents before hard delete to avoid orphaned chunks
    const sourcePath = `data-catalog/asset/${id}`
    try {
      const docs = await this.prisma.document.findMany({ where: { sourcePath }, select: { id: true } })
      if (docs.length > 0) {
        await this.prisma.document.deleteMany({ where: { sourcePath } })
        this.logger.log(`Deleted ${docs.length} indexed chunk(s) for asset ${id}`)
      }
    } catch (err) {
      this.logger.warn(`Could not clean up indexed docs for asset ${id}: ${(err as Error).message}`)
    }
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
      const nested = await this.getImpact(edge.target.id, new Set(visited))
      results.push(...nested)
    }

    return results
  }

  async autoRegister(dto: { projectId?: string; filePath: string; tool?: string }): Promise<{ asset: object; created: boolean }> {
    const normalized = dto.filePath.replace(/\\/g, '/')
    const name = normalized.split('/').pop() ?? dto.filePath
    const description = this.describeFilePath(normalized)

    const existing = await this.prisma.dataAsset.findFirst({
      where: {
        source: normalized,
        ...(dto.projectId ? { projectId: dto.projectId } : {}),
      },
    })

    if (existing) {
      return { asset: existing, created: false }
    }

    const asset = await this.createAsset({
      projectId: dto.projectId,
      name,
      type: 'file',
      description,
      source: normalized,
      sensitivity: 'internal',
    })
    return { asset, created: true }
  }

  private describeFilePath(p: string): string {
    const m = p.match(/apps\/api\/src\/modules\/([^/]+)/)
    if (m) return `Módulo API: ${m[1]}`
    if (/apps\/web\/app\/components/.test(p)) return 'Componente web'
    if (/apps\/web\/app\/hooks/.test(p)) return 'Hook web'
    if (/apps\/web\/app\/.+\/page\.tsx/.test(p)) return 'Página web'
    if (/apps\/agent\/src\/actions/.test(p)) return 'Ação do agente'
    if (/apps\/agent\/src\/hooks/.test(p)) return 'Hook do agente'
    if (/apps\/api-v2\/src\//.test(p)) return 'Módulo API V2'
    if (/prisma\/schema\.prisma/.test(p)) return 'Schema do banco de dados'
    if (/infra\//.test(p)) return 'Infraestrutura'
    if (/scripts\//.test(p)) return 'Script utilitário'
    if (/blueprints\//.test(p)) return 'Blueprint / design doc'
    return 'Arquivo de código'
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
