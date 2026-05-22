import { createHash } from 'crypto'
import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import { WikiService } from '../wiki/wiki.service'
import { BrainService } from '../brain/brain.service'
import { EventService } from '../event/event.service'
import { ProjectStateService } from '../project-state/project-state.service'
import { ImportBlueprintDto, BlueprintFormat } from './dto/import-blueprint.dto'
import { PreviewBlueprintDto } from './dto/preview-blueprint.dto'
import {
  BlueprintImportResult,
  BlueprintPreviewResult,
  BlueprintSuggestedEvent,
} from './dto/blueprint-result.dto'
import { parseMarkdown, ParsedBlueprint } from './parsers/blueprint-markdown.parser'
import { parseJson } from './parsers/blueprint-json.parser'

const CONTENT_MAX_CHARS = 60_000

@Injectable()
export class BlueprintService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly wiki: WikiService,
    private readonly brain: BrainService,
    private readonly eventService: EventService,
    private readonly stateService: ProjectStateService,
  ) {}

  // ─── Preview ─────────────────────────────────────────────────────────────────

  async preview(dto: PreviewBlueprintDto): Promise<BlueprintPreviewResult> {
    const parsed = this.parse(dto.content, dto.format, dto.title)
    const titleSlug = this.titleSlug(dto.title)

    return {
      detectedSections: parsed.sections.map((s) => s.title),
      suggestedWikiPages: [
        `blueprint-${titleSlug}`,
        ...parsed.sections.map((s) => this.sectionSlug(titleSlug, s.slug)),
      ],
      suggestedEvents: this.buildSuggestedEvents(parsed),
      suggestedNextSteps: parsed.nextSteps,
      risks: this.detectRisks(parsed),
    }
  }

  // ─── Import ──────────────────────────────────────────────────────────────────

  async import(dto: ImportBlueprintDto): Promise<BlueprintImportResult> {
    const project = await this.prisma.project.findUnique({ where: { id: dto.projectId } })
    if (!project) throw new NotFoundException(`Projeto não encontrado: ${dto.projectId}`)

    const opts = {
      saveToWiki:        dto.options?.saveToWiki        ?? true,
      indexInBrain:      dto.options?.indexInBrain      ?? true,
      updateProjectState:dto.options?.updateProjectState ?? true,
      createEvents:      dto.options?.createEvents      ?? true,
      generateNextSteps: dto.options?.generateNextSteps ?? true,
      overwriteWiki:     dto.options?.overwriteWiki     ?? false,
    }

    const parsed = this.parse(dto.content, dto.format, dto.title)
    const warnings = new Set<string>()

    const result: BlueprintImportResult = {
      ok: true,
      projectId: dto.projectId,
      created: { wikiPages: [], documents: [], events: [], nextSteps: [] },
      updated: { projectState: false, brain: false, planning: false },
      warnings: [],
    }

    if (opts.saveToWiki)        await this.saveWiki(dto, parsed, opts.overwriteWiki, result, warnings)
    if (opts.indexInBrain)      await this.indexBrain(dto, result, warnings)
    if (opts.createEvents)      await this.createEvents(dto, parsed, result, warnings)

    if (opts.updateProjectState && opts.generateNextSteps && parsed.nextSteps.length > 0) {
      await this.updatePlanning(dto.projectId, parsed, result, warnings)
    }

    result.warnings = [...warnings]
    return result
  }

  // ─── Wiki ─────────────────────────────────────────────────────────────────────

  private async saveWiki(
    dto: ImportBlueprintDto,
    parsed: ParsedBlueprint,
    overwrite: boolean,
    result: BlueprintImportResult,
    warnings: Set<string>,
  ): Promise<void> {
    const titleSlug = this.titleSlug(dto.title)
    const mainSlug = `blueprint-${titleSlug}`

    const existing = await this.prisma.wikiPage.findFirst({ where: { slug: mainSlug } })
    if (existing && !overwrite) {
      warnings.add(`Wiki "${mainSlug}" já existe. Use overwriteWiki: true para sobrescrever.`)
    } else {
      await this.wiki.create(mainSlug, dto.title, this.buildMainWikiContent(dto, parsed, titleSlug))
      result.created.wikiPages.push(mainSlug)
    }

    for (const section of parsed.sections) {
      const slug = this.sectionSlug(titleSlug, section.slug)
      const exists = await this.prisma.wikiPage.findFirst({ where: { slug } })

      if (exists && !overwrite) {
        warnings.add(`Wiki de seção "${slug}" já existe. Use overwriteWiki: true para sobrescrever.`)
        continue
      }

      if (section.content.trim()) {
        await this.wiki.create(slug, section.title, section.content)
        result.created.wikiPages.push(slug)
      }
    }
  }

  // ─── Brain ────────────────────────────────────────────────────────────────────

  private async indexBrain(
    dto: ImportBlueprintDto,
    result: BlueprintImportResult,
    warnings: Set<string>,
  ): Promise<void> {
    try {
      const sourcePath = `blueprint/${this.titleSlug(dto.title)}`
      const indexed = await this.brain.indexText(dto.content, sourcePath)
      result.created.documents.push(...indexed.documentIds)
      result.updated.brain = true
    } catch (err) {
      warnings.add(`Brain indexing falhou: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // ─── Events ───────────────────────────────────────────────────────────────────

  private async createEvents(
    dto: ImportBlueprintDto,
    parsed: ParsedBlueprint,
    result: BlueprintImportResult,
    warnings: Set<string>,
  ): Promise<void> {
    try {
      const importEvent = await this.eventService.create({
        projectId: dto.projectId,
        source: 'cli',
        type: 'note',
        intent: 'reference',
        content: `Blueprint importado: "${dto.title}" (source: ${dto.source})`,
        metadata: { blueprintTitle: dto.title, source: dto.source, format: dto.format, mode: dto.mode, sections: parsed.sections.length },
      })
      result.created.events.push(importEvent.id)

      for (const decision of parsed.decisions) {
        const ev = await this.eventService.create({
          projectId: dto.projectId, source: 'cli', type: 'decision', intent: 'decision',
          content: decision, metadata: { origin: 'blueprint', blueprintTitle: dto.title },
        })
        result.created.events.push(ev.id)
      }

      for (const problem of parsed.problems) {
        const ev = await this.eventService.create({
          projectId: dto.projectId, source: 'cli', type: 'note', intent: 'problem',
          content: problem, metadata: { origin: 'blueprint', blueprintTitle: dto.title },
        })
        result.created.events.push(ev.id)
      }
    } catch (err) {
      warnings.add(`createEvents falhou: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // ─── Planning ─────────────────────────────────────────────────────────────────

  private async updatePlanning(
    projectId: string,
    parsed: ParsedBlueprint,
    result: BlueprintImportResult,
    warnings: Set<string>,
  ): Promise<void> {
    try {
      const backlogItems = parsed.tasks.map((t, i) => ({
        id: `blueprint-task-${Date.now()}-${i}`,
        title: t.title,
        priority: t.priority as 'high' | 'medium' | 'low',
      }))

      await this.stateService.updatePlanning(projectId, {
        nextSteps: parsed.nextSteps,
        backlog: backlogItems,
      })

      result.created.nextSteps.push(...parsed.nextSteps)
      result.updated.projectState = true
      result.updated.planning = true
    } catch (err) {
      warnings.add(`updatePlanning falhou: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────────

  private parse(content: string, format: BlueprintFormat, title: string): ParsedBlueprint {
    const trimmed = content.trim()
    if (!trimmed) throw new BadRequestException('content não pode ser vazio')
    if (trimmed.length > CONTENT_MAX_CHARS) {
      throw new BadRequestException(`content excede o limite de ${CONTENT_MAX_CHARS} caracteres (recebido: ${trimmed.length})`)
    }
    return format === BlueprintFormat.JSON ? parseJson(content, title) : parseMarkdown(content, title)
  }

  private toSlug(text: string): string {
    return text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
  }

  /** Slug do título: truncado em 35 chars */
  private titleSlug(title: string): string {
    return this.toSlug(title).slice(0, 35).replace(/-$/, '')
  }

  /** Slug de seção: blueprint-{title35}-{section20}-{hash6} — sem colisão mesmo com prefixos parecidos */
  private sectionSlug(titleSlug: string, sectionSlug: string): string {
    const sec = this.toSlug(sectionSlug).slice(0, 20).replace(/-$/, '')
    const hash = createHash('sha1').update(`${titleSlug}:${sectionSlug}`).digest('hex').slice(0, 6)
    return `blueprint-${titleSlug}-${sec}-${hash}`
  }

  private buildSuggestedEvents(parsed: ParsedBlueprint): BlueprintSuggestedEvent[] {
    return [
      ...parsed.decisions.map((d) => ({ intent: 'decision' as const, content: d })),
      ...parsed.problems.map((p) => ({ intent: 'problem' as const, content: p })),
    ]
  }

  private detectRisks(parsed: ParsedBlueprint): string[] {
    const risks: string[] = []
    if (parsed.sections.length === 0) risks.push('Nenhuma seção detectada — verifique se o conteúdo está bem estruturado.')
    if (parsed.nextSteps.length === 0 && parsed.tasks.length === 0) risks.push('Nenhum item de ação detectado.')
    if (parsed.problems.length > 3) risks.push(`${parsed.problems.length} problemas identificados — considere resolver os blockers antes de importar.`)
    return risks
  }

  private buildMainWikiContent(dto: ImportBlueprintDto, parsed: ParsedBlueprint, titleSlug: string): string {
    const lines: string[] = [
      `# ${dto.title}`,
      '',
      `> Blueprint importado de: \`${dto.source}\` | Modo: \`${dto.mode ?? 'manual'}\``,
      '',
    ]

    if (parsed.sections.length > 0) {
      lines.push('## Seções')
      for (const s of parsed.sections) {
        lines.push(`- [[${this.sectionSlug(titleSlug, s.slug)}|${s.title}]]`)
      }
      lines.push('')
    }

    if (parsed.decisions.length > 0) {
      lines.push('## Decisões registradas')
      parsed.decisions.forEach((d) => lines.push(`- ${d}`))
      lines.push('')
    }

    if (parsed.nextSteps.length > 0) {
      lines.push('## Próximos passos')
      parsed.nextSteps.forEach((n) => lines.push(`- [ ] ${n}`))
      lines.push('')
    }

    lines.push('---', '*Conteúdo original preservado abaixo*', '', dto.content)
    return lines.join('\n')
  }
}
