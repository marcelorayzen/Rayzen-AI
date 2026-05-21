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

    const suggestedWikiPages = this.buildWikiPageSlugs(dto.title, parsed)
    const suggestedEvents = this.buildSuggestedEvents(parsed)
    const risks = this.detectRisks(parsed)

    return {
      detectedSections: parsed.sections.map((s) => s.title),
      suggestedWikiPages,
      suggestedEvents,
      suggestedNextSteps: parsed.nextSteps,
      risks,
    }
  }

  // ─── Import ──────────────────────────────────────────────────────────────────

  async import(dto: ImportBlueprintDto): Promise<BlueprintImportResult> {
    const project = await this.prisma.project.findUnique({ where: { id: dto.projectId } })
    if (!project) throw new NotFoundException(`Projeto não encontrado: ${dto.projectId}`)

    const opts = {
      saveToWiki: dto.options?.saveToWiki ?? true,
      indexInBrain: dto.options?.indexInBrain ?? true,
      updateProjectState: dto.options?.updateProjectState ?? true,
      createEvents: dto.options?.createEvents ?? true,
      generateNextSteps: dto.options?.generateNextSteps ?? true,
      overwriteWiki: dto.options?.overwriteWiki ?? false,
    }

    const parsed = this.parse(dto.content, dto.format, dto.title)

    const result: BlueprintImportResult = {
      ok: true,
      projectId: dto.projectId,
      created: { wikiPages: [], documents: [], events: [], nextSteps: [] },
      updated: { projectState: false, brain: false, planning: false },
      warnings: [],
    }

    // 1. Wiki
    if (opts.saveToWiki) {
      await this.saveWiki(dto, parsed, opts.overwriteWiki, result)
    }

    // 2. Brain
    if (opts.indexInBrain) {
      await this.indexBrain(dto, result)
    }

    // 3. Eventos
    if (opts.createEvents) {
      await this.createEvents(dto, parsed, result)
    }

    // 4. Planning / ProjectState
    if (opts.updateProjectState && opts.generateNextSteps && parsed.nextSteps.length > 0) {
      await this.updatePlanning(dto.projectId, parsed, result)
    }

    return result
  }

  // ─── Wiki ─────────────────────────────────────────────────────────────────────

  private async saveWiki(
    dto: ImportBlueprintDto,
    parsed: ParsedBlueprint,
    overwrite: boolean,
    result: BlueprintImportResult,
  ): Promise<void> {
    const mainSlug = this.toSlug(`blueprint-${dto.title}`)

    const existing = await this.prisma.wikiPage.findFirst({ where: { slug: mainSlug } })
    if (existing && !overwrite) {
      result.warnings.push(
        `Wiki "${mainSlug}" já existe. Use overwriteWiki: true para sobrescrever.`,
      )
    } else {
      const mainContent = this.buildMainWikiContent(dto, parsed)
      await this.wiki.create(mainSlug, dto.title, mainContent)
      result.created.wikiPages.push(mainSlug)
    }

    for (const section of parsed.sections) {
      const sectionSlug = this.toSlug(`blueprint-${dto.title}-${section.slug}`)
      const sectionExisting = await this.prisma.wikiPage.findFirst({ where: { slug: sectionSlug } })

      if (sectionExisting && !overwrite) {
        result.warnings.push(`Wiki de seção "${sectionSlug}" já existe e não foi sobrescrita.`)
        continue
      }

      if (section.content.trim()) {
        await this.wiki.create(sectionSlug, section.title, section.content)
        result.created.wikiPages.push(sectionSlug)
      }
    }
  }

  // ─── Brain ────────────────────────────────────────────────────────────────────

  private async indexBrain(
    dto: ImportBlueprintDto,
    result: BlueprintImportResult,
  ): Promise<void> {
    try {
      const sourcePath = `blueprint/${this.toSlug(dto.title)}`
      const indexed = await this.brain.indexText(dto.content, sourcePath)
      result.created.documents.push(...indexed.documentIds)
      result.updated.brain = true
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      result.warnings.push(`Brain indexing falhou: ${msg}`)
    }
  }

  // ─── Events ───────────────────────────────────────────────────────────────────

  private async createEvents(
    dto: ImportBlueprintDto,
    parsed: ParsedBlueprint,
    result: BlueprintImportResult,
  ): Promise<void> {
    const importEvent = await this.eventService.create({
      projectId: dto.projectId,
      source: 'cli',
      type: 'note',
      intent: 'reference',
      content: `Blueprint importado: "${dto.title}" (source: ${dto.source})`,
      metadata: {
        blueprintTitle: dto.title,
        source: dto.source,
        format: dto.format,
        mode: dto.mode,
        sections: parsed.sections.length,
      },
    })
    result.created.events.push(importEvent.id)

    for (const decision of parsed.decisions) {
      const ev = await this.eventService.create({
        projectId: dto.projectId,
        source: 'cli',
        type: 'decision',
        intent: 'decision',
        content: decision,
        metadata: { origin: 'blueprint', blueprintTitle: dto.title },
      })
      result.created.events.push(ev.id)
    }

    for (const problem of parsed.problems) {
      const ev = await this.eventService.create({
        projectId: dto.projectId,
        source: 'cli',
        type: 'note',
        intent: 'problem',
        content: problem,
        metadata: { origin: 'blueprint', blueprintTitle: dto.title },
      })
      result.created.events.push(ev.id)
    }
  }

  // ─── Planning ─────────────────────────────────────────────────────────────────

  private async updatePlanning(
    projectId: string,
    parsed: ParsedBlueprint,
    result: BlueprintImportResult,
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
      const msg = err instanceof Error ? err.message : String(err)
      result.warnings.push(`updatePlanning falhou: ${msg}`)
    }
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────────

  private parse(content: string, format: BlueprintFormat, title: string): ParsedBlueprint {
    if (!content.trim()) {
      throw new BadRequestException('content não pode ser vazio')
    }
    if (format === BlueprintFormat.JSON) {
      return parseJson(content, title)
    }
    return parseMarkdown(content, title)
  }

  private buildWikiPageSlugs(title: string, parsed: ParsedBlueprint): string[] {
    const slugs = [`blueprint-${this.toSlug(title)}`]
    for (const s of parsed.sections) {
      slugs.push(`blueprint-${this.toSlug(title)}-${s.slug}`)
    }
    return slugs
  }

  private buildSuggestedEvents(parsed: ParsedBlueprint): BlueprintSuggestedEvent[] {
    const events: BlueprintSuggestedEvent[] = []
    for (const d of parsed.decisions) {
      events.push({ intent: 'decision', content: d })
    }
    for (const p of parsed.problems) {
      events.push({ intent: 'problem', content: p })
    }
    return events
  }

  private detectRisks(parsed: ParsedBlueprint): string[] {
    const risks: string[] = []
    if (parsed.sections.length === 0) {
      risks.push('Nenhuma seção detectada — verifique se o conteúdo está bem estruturado.')
    }
    if (parsed.nextSteps.length === 0 && parsed.tasks.length === 0) {
      risks.push('Nenhum item de ação detectado.')
    }
    if (parsed.problems.length > 3) {
      risks.push(`${parsed.problems.length} problemas identificados — considere resolver os blockers antes de importar.`)
    }
    return risks
  }

  private buildMainWikiContent(dto: ImportBlueprintDto, parsed: ParsedBlueprint): string {
    const lines: string[] = [
      `# ${dto.title}`,
      '',
      `> Blueprint importado de: \`${dto.source}\` | Modo: \`${dto.mode ?? 'manual'}\``,
      '',
    ]

    if (parsed.sections.length > 0) {
      lines.push('## Seções')
      for (const s of parsed.sections) {
        lines.push(`- [[blueprint-${this.toSlug(dto.title)}-${s.slug}|${s.title}]]`)
      }
      lines.push('')
    }

    if (parsed.decisions.length > 0) {
      lines.push('## Decisões registradas')
      for (const d of parsed.decisions) lines.push(`- ${d}`)
      lines.push('')
    }

    if (parsed.nextSteps.length > 0) {
      lines.push('## Próximos passos')
      for (const n of parsed.nextSteps) lines.push(`- [ ] ${n}`)
      lines.push('')
    }

    lines.push('---')
    lines.push(`*Conteúdo original preservado abaixo*`)
    lines.push('')
    lines.push(dto.content)

    return lines.join('\n')
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
      .slice(0, 60)
  }
}
