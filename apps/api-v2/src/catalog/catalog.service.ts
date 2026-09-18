import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { Prisma } from '../../generated/prisma-client-v2'
import { PrismaV2Service } from '../core/prisma-v2.service'
import { V1BridgeService } from '../core/v1-bridge.service'
import { SystemStatusService } from '../system-status/system-status.service'

export interface UpsertCatalogDto {
  owner?: string
  provenance?: string
  tags?: string[]
  healthScore?: number | null
  metadata?: Record<string, unknown>
  archivedAt?: string | null
}

export interface CatalogEntry {
  catalogId:      string | null
  v1ProjectId:    string
  name:           string
  repoSlug:       string | null
  description:    string | null
  owner:          string | null
  provenance:     string
  tags:           string[]
  healthScore:    number | null
  metadata:       Record<string, unknown>
  missionCount:   number
  lastMissionAt:  Date | null
  archivedAt:     Date | null
  updatedAt:      Date | null
}

@Injectable()
export class CatalogService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CatalogService.name)
  private warmupTimer: ReturnType<typeof setTimeout>  | null = null
  private cycleTimer:  ReturnType<typeof setInterval> | null = null

  constructor(
    private readonly prisma: PrismaV2Service,
    private readonly bridge: V1BridgeService,
    private readonly system: SystemStatusService,
  ) {}

  /**
   * Registra projeto novo no catálogo sozinho.
   *
   * O catálogo só era preenchido por chamada explícita de API, e é isso que faz
   * um projeto novo nascer invisível para a V2: o QA Scientist e os invariantes
   * varrem o `project_catalog`, não a lista de projetos da V1. O Rayzen AI
   * passou **dois meses** fora do catálogo — o ciclo rodava todo dia, sobre nada,
   * sem erro nenhum.
   *
   * O invariante `projeto_ativo_no_catalogo` detecta o buraco desde então, mas
   * detectar não é o mesmo que funcionar: alguém ainda precisava ler o aviso e
   * agir. Este ciclo torna a falha impossível em vez de visível.
   *
   * Só cria o que falta, com `provenance: 'auto'` — nunca mexe em entrada que
   * já existe, porque `owner`, `tags` e `healthScore` são curadoria humana.
   */
  onModuleInit() {
    if (process.env.CATALOG_SYNC_ENABLED === 'false') {
      this.logger.log('CatalogService: sincronismo automático desligado por env')
      return
    }

    const WARMUP_MS   = 3 * 60 * 1000
    const INTERVAL_MS = 6 * 60 * 60 * 1000

    this.warmupTimer = setTimeout(() => {
      void this.syncNovosProjetos()
      this.cycleTimer = setInterval(() => void this.syncNovosProjetos(), INTERVAL_MS)
    }, WARMUP_MS)

    // Ciclo que sobe sem deixar rastro é indistinguível de ciclo que não subiu —
    // e essa confusão foi o que manteve o QA Scientist "parado" por semanas.
    this.logger.log('CatalogService: sync de projetos agendado (6h, primeira rodada em 3 min)')
  }

  onModuleDestroy() {
    if (this.warmupTimer) clearTimeout(this.warmupTimer)
    if (this.cycleTimer)  clearInterval(this.cycleTimer)
  }

  /** @returns quantos projetos entraram no catálogo nesta passada. */
  async syncNovosProjetos(): Promise<number> {
    // `beat` em `finally`: um ciclo que lança antes de reportar fica idêntico a
    // um ciclo que nunca subiu, e o painel volta a mentir do jeito antigo.
    let ok = false
    let erro: string | undefined
    let criados = 0
    try {
      const [v1Projects, catalogRows] = await Promise.all([
        this.bridge.listProjects(),
        this.prisma.projectCatalog.findMany({ select: { v1ProjectId: true } }),
      ])

      // `listProjects()` já filtra `status: 'active'` na origem — repetir o filtro
      // aqui daria a impressão de uma garantia que na verdade mora na ponte.
      const jaNoCatalogo = new Set(catalogRows.map((c) => c.v1ProjectId))
      const faltando = v1Projects.filter((p) => !jaNoCatalogo.has(p.id))

      for (const p of faltando) {
        await this.prisma.projectCatalog.create({
          data: { v1ProjectId: p.id, provenance: 'auto', tags: [] },
        })
        this.logger.log(`Catálogo: projeto "${p.name}" registrado automaticamente`)
      }

      criados = faltando.length
      ok = true
      return criados
    } catch (e) {
      erro = e instanceof Error ? e.message : String(e)
      this.logger.warn(`Sincronismo do catálogo falhou: ${erro}`)
      return 0
    } finally {
      await this.system.beat('catalog-sync', { ok, erro, detalhe: { criados } })
    }
  }

  async list(): Promise<CatalogEntry[]> {
    const [v1Projects, catalogRows, missionAgg] = await Promise.all([
      this.bridge.listProjects(),
      this.prisma.projectCatalog.findMany(),
      this.prisma.mission.groupBy({
        by: ['projectId'],
        _count: { id: true },
        _max:   { createdAt: true },
      }),
    ])

    const catalogMap = new Map(catalogRows.map((r) => [r.v1ProjectId, r]))
    const missionMap = new Map(missionAgg.map((r) => [r.projectId, r]))

    return v1Projects.map((p) => {
      const cat  = catalogMap.get(p.id) ?? null
      const miss = missionMap.get(p.id) ?? null
      return {
        catalogId:    cat?.id ?? null,
        v1ProjectId:  p.id,
        name:         p.name,
        repoSlug:     p.repoSlug ?? null,
        description:  p.description ?? null,
        owner:        cat?.owner ?? null,
        provenance:   cat?.provenance ?? 'manual',
        tags:         cat?.tags ?? [],
        healthScore:  cat?.healthScore ?? null,
        metadata:     (cat?.metadata as Record<string, unknown>) ?? {},
        missionCount: miss?._count.id ?? 0,
        lastMissionAt: miss?._max.createdAt ?? null,
        archivedAt:   cat?.archivedAt ?? null,
        updatedAt:    cat?.updatedAt ?? null,
      }
    })
  }

  async upsert(v1ProjectId: string, dto: UpsertCatalogDto): Promise<CatalogEntry> {
    await this.prisma.projectCatalog.upsert({
      where:  { v1ProjectId },
      create: {
        v1ProjectId,
        owner:       dto.owner ?? null,
        provenance:  dto.provenance ?? 'manual',
        tags:        dto.tags ?? [],
        healthScore: dto.healthScore ?? null,
        metadata:    (dto.metadata ?? {}) as Prisma.InputJsonValue,
        archivedAt:  dto.archivedAt ? new Date(dto.archivedAt) : null,
      },
      update: {
        ...(dto.owner       !== undefined && { owner:       dto.owner }),
        ...(dto.provenance  !== undefined && { provenance:  dto.provenance }),
        ...(dto.tags        !== undefined && { tags:        dto.tags }),
        ...(dto.healthScore !== undefined && { healthScore: dto.healthScore }),
        ...(dto.metadata    !== undefined && { metadata:    dto.metadata as Prisma.InputJsonValue }),
        ...(dto.archivedAt  !== undefined && { archivedAt:  dto.archivedAt ? new Date(dto.archivedAt) : null }),
      },
    })

    const entries = await this.list()
    return entries.find((e) => e.v1ProjectId === v1ProjectId) as CatalogEntry
  }

  async remove(v1ProjectId: string): Promise<void> {
    await this.prisma.projectCatalog.deleteMany({ where: { v1ProjectId } })
  }
}
