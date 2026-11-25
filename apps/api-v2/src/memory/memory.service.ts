import { BadRequestException, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { boostDoModo } from './memory-ranking.const'
import { PrismaV2Service } from '../core/prisma-v2.service'
import { V1ApiService } from '../core/v1-api.service'
import { V1BridgeService } from '../core/v1-bridge.service'
import { SystemStatusService } from '../system-status/system-status.service'
import { conhecimentoVigente } from '../core/knowledge-validity.const'
import { StoreMemoryDto, SearchMemoryDto, MemoryClass, MemoryType } from './dto/memory.dto'


/**
 * `learningType` do `captureLearning` (V1) → `memoryType` do ciclo de vida (V2).
 *
 * São vocabulários diferentes porque nasceram em lados diferentes do sistema.
 * O mapa é explícito para que a tradução seja auditável — derivar por heurística
 * de texto seria adivinhação sobre dado que já está estruturado.
 */
const LEARNING_TYPE_PARA_MEMORY_TYPE: Record<string, MemoryType> = {
  decision:        'decision',
  pattern:         'pattern',
  runbook:         'pattern',        // procedimento repetível
  troubleshooting: 'lesson',
  gotcha:          'lesson',
}

@Injectable()
export class MemoryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MemoryService.name)
  private warmupTimer: ReturnType<typeof setTimeout>  | null = null
  private cycleTimer:  ReturnType<typeof setInterval> | null = null

  constructor(
    private readonly prisma: PrismaV2Service,
    private readonly v1Api: V1ApiService,
    private readonly bridge: V1BridgeService,
    private readonly system: SystemStatusService,
  ) {}

  /**
   * Ciclo de backfill do ciclo de vida.
   *
   * Alternativa descartada: fazer o MCP chamar uma segunda rota depois do
   * `captureLearning`. Wiring que depende de alguém lembrar de chamar é a falha
   * do `setCostController()` — que nenhum módulo chamou e deixou a V2 três meses
   * sem registrar custo. Além disso deixaria de fora qualquer cliente futuro.
   *
   * Aqui o backfill pega aprendizado de qualquer origem, e cura o passado.
   */
  onModuleInit() {
    if (process.env.MEMORY_BACKFILL_ENABLED === 'false') {
      this.logger.log('MemoryService: backfill de ciclo de vida desligado por env')
      return
    }

    const WARMUP_MS   = 4 * 60 * 1000
    const INTERVAL_MS = 15 * 60 * 1000

    this.warmupTimer = setTimeout(() => {
      void this.backfillLifecycle()
      this.cycleTimer = setInterval(() => void this.backfillLifecycle(), INTERVAL_MS)
    }, WARMUP_MS)

    this.logger.log('MemoryService: backfill de ciclo de vida agendado (15min, primeira em 4 min)')
  }

  onModuleDestroy() {
    if (this.warmupTimer) clearTimeout(this.warmupTimer)
    if (this.cycleTimer)  clearInterval(this.cycleTimer)
  }

  /**
   * Dá ciclo de vida a aprendizado que não tem.
   *
   * @returns quantos ganharam linha nesta passada.
   */
  async backfillLifecycle(): Promise<number> {
    let ok = false
    let erro: string | undefined
    let criados = 0
    let semTipo = 0

    try {
      const docs = await this.bridge.listLearningDocuments()
      if (docs.length === 0) { ok = true; return 0 }

      const jaTem = new Set(
        (await this.prisma.memoryMeta.findMany({
          where:  { v1DocumentId: { in: docs.map((d) => d.id) } },
          select: { v1DocumentId: true },
        })).map((m) => m.v1DocumentId),
      )

      for (const d of docs) {
        if (jaTem.has(d.id) || !d.projectId) continue

        const meta = (d.metadata ?? {}) as Record<string, unknown>
        const learningType = typeof meta.learningType === 'string' ? meta.learningType : ''
        const memoryType = LEARNING_TYPE_PARA_MEMORY_TYPE[learningType]

        // Sem tipo conhecido não inventa: o aprendizado entra com ciclo de vida
        // mas sem `memoryType`, e o contador acusa. Chutar o tipo seria pior que
        // não ter — o boost por tipo passaria a mentir.
        if (!memoryType) semTipo++

        await this.prisma.memoryMeta.create({
          data: {
            v1DocumentId: d.id,
            projectId:    d.projectId,
            memoryClass:  this.classeInicial({ memoryType } as StoreMemoryDto),
            memoryType,
          },
        })
        criados++
      }

      if (criados > 0) {
        this.logger.log(`Backfill de memória: ${criados} aprendizado(s) ganharam ciclo de vida (${semTipo} sem tipo reconhecido)`)
      }
      ok = true
      return criados
    } catch (e) {
      erro = e instanceof Error ? e.message : String(e)
      this.logger.warn(`Backfill de memória falhou: ${erro}`)
      return 0
    } finally {
      await this.system.beat('memory-backfill', { ok, erro, detalhe: { criados, semTipo } })
    }
  }

  async store(dto: StoreMemoryDto) {
    if (dto.memoryClass === 'consolidated') {
      throw new BadRequestException('Use knowledge/proposals and owner approval for canonical knowledge')
    }
    // 1. Index in V1 storage (pgvector)
    const indexed = await this.v1Api.indexContent({
      projectId:  dto.projectId,
      content:    dto.content,
      sourcePath: dto.sourcePath,
      sourceType: dto.sourceType ?? 'manual',
    })

    if (!indexed.id) return { success: true, documentId: null, memoryClass: this.classeInicial(dto) }

    const memoryClass = this.classeInicial(dto)

    // 2. Upsert lifecycle metadata in v2
    //
    // Este era o ponto de conflito com o módulo `project-memory`, removido em
    // 2026-08-15: os dois faziam upsert aqui pela mesma chave `v1DocumentId`,
    // com `update` escrevendo campos diferentes. Um `store()` genérico rebaixaria
    // para `inbox` uma decisão que o outro tinha marcado como `consolidated` —
    // e nada no sistema acusaria. Agora existe um escritor só.
    const meta = await this.prisma.memoryMeta.upsert({
      where:  { v1DocumentId: indexed.id },
      create: {
        v1DocumentId: indexed.id,
        projectId:    dto.projectId,
        memoryClass,
        memoryType:   dto.memoryType,
        missionId:    dto.missionId,
        confidence:   dto.confidence,
      },
      update: {
        memoryClass,
        updatedAt: new Date(),
        // Campos tipados só sobrescrevem quando informados: um `store()` sem
        // tipo não pode apagar o tipo que outra chamada já registrou.
        ...(dto.memoryType !== undefined && { memoryType: dto.memoryType }),
        ...(dto.missionId  !== undefined && { missionId:  dto.missionId  }),
        ...(dto.confidence !== undefined && { confidence: dto.confidence }),
      },
    })

    return { success: true, documentId: indexed.id, memoryClass: meta.memoryClass }
  }

  /** Fonte operacional nunca vira conhecimento canônico por tipo ou frequência. */
  private classeInicial(dto: StoreMemoryDto): MemoryClass {
    if (dto.memoryClass) return dto.memoryClass
    return 'inbox'
  }

  async search(dto: SearchMemoryDto) {
    const limit = dto.limit ?? 10

    // Search V1 — raw path (vector only, no LLM synthesis) to stay within hook timeout budget
    const results = await this.v1Api.searchMemoryRaw(dto.projectId, dto.query, Math.min(limit * 5, 50))

    if (results.length === 0) return { results: [], total: 0 }

    // Fetch lifecycle metadata for results
    const docIds = results.map((r) => r.id)
    const metas  = await this.prisma.memoryMeta.findMany({
      where: { v1DocumentId: { in: docIds }, projectId: dto.projectId },
    })
    const metaMap = new Map(metas.map((m) => [m.v1DocumentId, m]))

    const projections = this.prisma.knowledgeProjection
      ? await this.prisma.knowledgeProjection.findMany({
          where: { externalId: { in: docIds } },
          include: {
            knowledgeVersion: {
              include: { proposal: { include: { source: true } } },
            },
          },
        })
      : []
    const now = new Date()
    const governedExternalIds = new Set(projections.map((p) => p.externalId))
    const projectionMap = new Map<string | null, (typeof projections)[number]>()
    for (const projection of projections) {
      // Vigência vem de `knowledge-validity.const.ts`, a mesma que o ContextPack usa.
      // O `ready` fica aqui porque é condição do ÍNDICE, não do conhecimento: um pacote
      // autorizado lê a versão canônica direto e não depende da cópia vetorial.
      const current = projection.status === 'ready'
        && conhecimentoVigente(projection.knowledgeVersion, now)
      if (current) projectionMap.set(projection.externalId, projection)
    }

    // Filter by requested classes
    const classFilter = dto.classes ?? (['inbox', 'working', 'consolidated'] as MemoryClass[])

    // Boost do modo — ordem e pesos vêm de `@rayzen/types`, fonte única.
    //
    // A V1 declarava `memoryClassPriority` e a V2 tinha tabela própria de pesos:
    // três dos cinco modos discordavam. E o peso era +0.20 sobre um score de
    // similaridade cujos resultados relevantes se espaçam ~0,07 — o modo deixava
    // de inclinar o ranking e passava a substituí-lo.
    const seenContent = new Set<string>()
    const seenDoc     = new Set<string>()
    const scored = results
      .filter((r) => {
        const projection = projectionMap.get(r.id)
        if (!governedExternalIds.has(r.id)) return true
        return Boolean(projection)
      })
      .map((r) => {
        const meta  = metaMap.get(r.id)
        const projection = projectionMap.get(r.id)
        const knowledge = projection?.knowledgeVersion
        const tipo  = (knowledge?.knowledgeType ?? meta?.memoryType ?? null) as MemoryType | null

        // "Sem etiqueta" NÃO é `inbox`. São coisas diferentes, e confundi-las
        // invertia o ranking: `inbox` faz parte das listas de preferência, então um
        // documento sem classificação nenhuma recebia o peso da posição de `inbox`.
        // Em `study`, onde `inbox` é o SEGUNDO da lista, isso valia +0.015 — mais
        // que os +0.005 do `working` curado. Na prática um `pnpm-lock.yaml` vencia
        // uma lição curada.
        //
        // Medido em 2026-08-18: **97,4% do acervo não tem etiqueta** (45 de 1.715 no
        // Rayzen AI), e nenhum documento de arquivo tem — nem poderia: `decision`,
        // `lesson`, `pattern` e `constraint` descrevem conhecimento curado, não um
        // `page.tsx`. O boost por modo opera sobre conhecimento curado; para o resto
        // vale a similaridade de cosseno, que é o que dá para medir num arquivo.
        const classeCurada = (knowledge ? 'consolidated' : (meta?.memoryClass ?? null)) as MemoryClass | null

        // Tipo entra no ranking porque responde ao modo melhor que ciclo de vida:
        // em arquitetura o que importa é ser uma DECISÃO, não há quanto tempo
        // está consolidada.
        const boost = boostDoModo(dto.mode, classeCurada, tipo)

        // Para FILTRAR, documento sem etiqueta continua contando como `inbox` — é o
        // que mantém arquivo visível na busca. O que muda é só o peso.
        const cls = classeCurada ?? ('inbox' as MemoryClass)
        return {
          ...r,
          memoryClass: cls,
          memoryType: tipo,
          accessCount: meta?.accessCount ?? 0,
          score: r.score + boost,
          recordKind: knowledge ? ('knowledge' as const) : ('source' as const),
          lifecycle: knowledge ? ('approved' as const) : ('source' as const),
          version: knowledge?.version ?? 1,
          origin: knowledge
            ? {
                sourceId: knowledge.sourceId,
                sourceIdentity: knowledge.proposal.source.sourceIdentity,
                sourceType: knowledge.proposal.source.sourceType,
                capturedAt: knowledge.proposal.source.capturedAt,
              }
            : { sourcePath: r.sourcePath ?? null, capturedAt: r.createdAt ?? null },
          approvedAt: knowledge?.approvedAt ?? null,
          validFrom: knowledge?.validFrom ?? null,
          validUntil: knowledge?.validUntil ?? null,
        }
      })
      .filter((r) => classFilter.includes(r.memoryClass as MemoryClass))
      .sort((a, b) => b.score - a.score)
      .filter((r) => {
        const fp = (r.content ?? '').slice(0, 200)
        if (seenContent.has(fp)) return false
        seenContent.add(fp)
        return true
      })
      // Um documento, uma linha — o melhor pedaço dele.
      //
      // O dedup acima pega texto idêntico; não pega dois CHUNKS do mesmo arquivo, que têm
      // conteúdo diferente e passam os dois. Medido em 2026-08-21 sobre 10 consultas reais
      // (docs/memoria-n1-baseline-precisao.md): **9 dos 50 slots** foram para um documento
      // que já estava na lista — `project_memory_ranking.md` em 4º, 5º e 6º; o blueprint do
      // Guardian idem; `layout.tsx` e `page.tsx` duas vezes cada.
      //
      // Com apenas 5 slots, largura vale mais que profundidade: cinco documentos dizem mais
      // que três, sendo que dois deles se repetem. O caso oposto — duas partes distintas de
      // um arquivo grande serem ambas relevantes — existe, mas não apareceu em nenhuma das
      // 10 consultas, enquanto o desperdício apareceu em 6.
      //
      // A chave cai no `id` quando não há caminho: sem isso, todo documento sem `sourcePath`
      // colapsaria num só.
      .filter((r) => {
        const doc = r.sourcePath ?? r.id
        if (seenDoc.has(doc)) return false
        seenDoc.add(doc)
        return true
      })
      .slice(0, limit)

    // Update access counts for retrieved docs
    void this.trackAccess(scored.map((r) => r.id), dto.projectId)

    return { results: scored, total: scored.length }
  }

  /**
   * `memoryType` substitui as rotas `/decisions` e `/failures` do módulo
   * `project-memory`: um filtro no que já existe, em vez de duas rotas paralelas
   * consultando a mesma tabela.
   */
  async list(projectId: string, memoryClass?: MemoryClass, memoryType?: MemoryType) {
    const docs = await this.v1Api.listDocuments(projectId)

    // Enrich with V2 lifecycle
    const metas = await this.prisma.memoryMeta.findMany({
      where: {
        projectId,
        ...(memoryClass ? { memoryClass } : {}),
        ...(memoryType  ? { memoryType }  : {}),
      },
    })
    const metaMap = new Map(metas.map((m) => [m.v1DocumentId, m]))

    // Filtro por tipo é seletivo: sem isto, pedir só as decisões devolveria a
    // lista inteira de documentos com o campo vazio.
    const docsFiltrados = memoryType ? docs.filter((d) => metaMap.has(d.id)) : docs

    return docsFiltrados.map((d) => ({
      ...d,
      memoryClass:  metaMap.get(d.id)?.memoryClass ?? 'inbox',
      memoryType:   metaMap.get(d.id)?.memoryType ?? null,
      accessCount:  metaMap.get(d.id)?.accessCount ?? 0,
      lastAccessAt: metaMap.get(d.id)?.lastAccessAt ?? null,
    }))
  }

  async updateClass(documentId: string, projectId: string, memoryClass: MemoryClass) {
    if (memoryClass === 'consolidated') {
      throw new BadRequestException('Use knowledge/proposals and owner approval for canonical knowledge')
    }
    return this.prisma.memoryMeta.upsert({
      where:  { v1DocumentId: documentId },
      create: { v1DocumentId: documentId, projectId, memoryClass },
      update: { memoryClass },
    })
  }

  async delete(documentId: string) {
    await this.v1Api.deleteDocument(documentId)
    await this.prisma.memoryMeta.deleteMany({ where: { v1DocumentId: documentId } })
  }

  async stats(projectId: string) {
    const metas = await this.prisma.memoryMeta.groupBy({
      by: ['memoryClass'],
      where: { projectId },
      _count: true,
    })

    const distribution = Object.fromEntries(metas.map((m) => [m.memoryClass, m._count]))
    const totalInV2    = metas.reduce((s, m) => s + m._count, 0)

    return { projectId, totalTracked: totalInV2, distribution }
  }

  private async trackAccess(docIds: string[], projectId: string) {
    try {
      await this.prisma.memoryMeta.updateMany({
        where: { v1DocumentId: { in: docIds }, projectId },
        data:  { accessCount: { increment: 1 }, lastAccessAt: new Date() },
      })
    } catch (e) {
      this.logger.warn(`trackAccess failed: ${e}`)
    }
  }
}
