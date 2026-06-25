import { Controller, Get, Post, Patch, Body, Query, Param, Inject, forwardRef } from '@nestjs/common'
import { ApiTags, ApiOperation } from '@nestjs/swagger'
import { EventService, CreateEventDto, EventSource, MemoryClass } from './event.service'
import { SynthesisService } from '../synthesis/synthesis.service'
import { PrismaService } from '../../prisma/prisma.service'
import { MemoryService } from '../memory/memory.service'
import { normalizeSlug } from '../project/project.service'

function inferIntent(tool: string, filePath?: string): CreateEventDto['intent'] | undefined {
  if (filePath && /CLAUDE\.md|AGENTS\.md|ADR|decisions/i.test(filePath)) return 'decision'
  if (tool === 'Stop') return 'checkpoint'
  return undefined
}

interface GitContext {
  branch?: string
  commitHash?: string
  commitMessage?: string
  commitAuthor?: string
  changedFiles?: string[]
}

// Payload enviado pelo hook do Claude Code via stdin
interface CliHookPayload {
  hook_event_name?: string   // PostToolUse | Stop | Notification
  tool_name?: string         // Edit | Write | Bash | Read | ...
  tool_input?: Record<string, unknown>
  tool_response?: unknown
  session_id?: string
  transcript?: Array<{ role: string; content: string }>
  projectId?: string         // UUID explícito (opcional — tem prioridade)
  projectName?: string       // nome do projeto para auto-resolução (fallback)
  git?: GitContext           // enriquecido pelo hook
  fileContent?: string       // conteúdo do arquivo para indexação semântica (Edit/Write)
  // Campos de evento direto (MCP rayzen_add_event) ou hook-timing
  content?: string
  source?: string
  type?: string
  intent?: string
  metadata?: Record<string, unknown>
}

@ApiTags('events')
@Controller('events')
export class EventController {

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventService,
    private readonly synthesis: SynthesisService,
    @Inject(forwardRef(() => MemoryService)) private readonly memory: MemoryService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Registrar evento manualmente' })
  create(@Body() dto: CreateEventDto) {
    return this.events.create(dto)
  }

  @Post('cli')
  @ApiOperation({ summary: 'Recebe payload do hook do Claude Code e salva como evento' })
  async fromCli(@Body() payload: CliHookPayload) {
    // Resolve projectId: UUID explícito > resolução robusta por slug/nome > undefined
    let projectId = payload.projectId ?? undefined
    if (!projectId && payload.projectName) {
      const target = normalizeSlug(payload.projectName)
      const all = await this.prisma.project.findMany({
        select: { id: true, name: true, repoSlug: true },
      })
      // Compara slug do hook contra repoSlug e nome normalizados de cada projeto
      const found =
        all.find((p) => p.repoSlug && normalizeSlug(p.repoSlug) === target) ??
        all.find((p) => normalizeSlug(p.name) === target)
      if (found) projectId = found.id
    }

    // Evento direto via MCP (rayzen_add_event) ou hook-timing: tem content mas não tem hook_event_name/tool_name
    if (payload.content && !payload.hook_event_name && !payload.tool_name) {
      const allowedSources: EventSource[] = ['cli', 'manual', 'brain']
      return this.events.create({
        projectId,
        source: allowedSources.includes(payload.source as EventSource)
          ? (payload.source as EventSource)
          : 'manual',
        type: (payload.type as CreateEventDto['type']) ?? 'note',
        intent: payload.intent as CreateEventDto['intent'],
        content: payload.content,
        metadata: payload.metadata,
      })
    }

    const hookEvent = payload.hook_event_name ?? 'PostToolUse'

    // Hook Stop — registra encerramento e fecha o loop
    if (hookEvent === 'Stop') {
      const messageCount = payload.transcript?.length ?? 0

      if (messageCount > 0 && projectId) {
        await this.events.create({
          projectId,
          source: 'cli',
          type: 'note',
          intent: 'checkpoint',
          content: `Sessão encerrada (${messageCount} mensagens)${payload.git?.branch ? ` [${payload.git.branch}]` : ''}`,
          metadata: { sessionId: payload.session_id, messageCount, git: payload.git ?? null },
        })
      }

      if (payload.session_id && projectId) {
        // Contar edições de código desta sessão para decidir profundidade
        const codeEdits = await this.prisma.event.count({
          where: {
            projectId,
            type: 'note',
            source: 'cli',
            metadata: { path: ['sessionId'], equals: payload.session_id },
          },
        })

        if (codeEdits >= 3) {
          // Sessão substancial → checkpoint completo (state + docs + Universe)
          this.synthesis.checkpoint(
            projectId,
            `Auto-checkpoint: sessão com ${codeEdits} edições de código`,
          ).catch(() => null)
        } else {
          // Sessão leve → apenas síntese
          this.synthesis.synthesizeSession(payload.session_id, projectId).catch(() => null)
        }
      } else if (payload.session_id) {
        this.synthesis.synthesizeSession(payload.session_id, projectId).catch(() => null)
      }

      return { ok: true }
    }

    // Hook PostToolUse — captura por ferramenta
    const tool = payload.tool_name ?? 'unknown'
    const input = payload.tool_input ?? {}

    // Ignorar ferramentas de baixo sinal
    if (['TodoWrite', 'TodoRead', 'ListMcpResourcesTool'].includes(tool)) {
      return { skipped: true }
    }

    let content = ''
    let type: CreateEventDto['type'] = 'execution'

    const gitSuffix = payload.git?.branch ? ` [${payload.git.branch}${payload.git.commitHash ? `@${payload.git.commitHash}` : ''}]` : ''

    if (tool === 'Edit' || tool === 'Write') {
      const filePath = (input['file_path'] as string) ?? (input['path'] as string) ?? 'arquivo'
      content = `${tool}: ${filePath}${gitSuffix}`
      type = 'note'

      // Auto-index file content into pgvector when hook sends fileContent
      const fileContent = payload.fileContent
      if (fileContent) {
        this.memory.indexDocument(
          fileContent,
          filePath,
          { tool, source: 'cli', sessionId: payload.session_id },
          projectId,
        ).catch(() => null)
      }
    } else if (tool === 'Bash' || tool === 'PowerShell') {
      const desc = input['_useDescription'] ? String(input['description'] ?? '').slice(0, 200) : ''
      const cmd  = String(input['command'] ?? '').slice(0, 200)
      content = `${tool}: ${desc || cmd}${gitSuffix}`
      type = 'execution'
    } else {
      content = `${tool}: ${JSON.stringify(input).slice(0, 150)}${gitSuffix}`
    }

    const filePath = tool === 'Edit' || tool === 'Write'
      ? ((input['file_path'] as string) ?? (input['path'] as string))
      : undefined

    return this.events.create({
      projectId,
      source: 'cli',
      type,
      content,
      intent: inferIntent(tool, filePath),
      metadata: { tool, input, sessionId: payload.session_id, git: payload.git ?? null },
    })
  }

  @Patch(':id/class')
  @ApiOperation({ summary: 'Promover ou rebaixar evento manualmente: inbox | working | consolidated | archive' })
  updateClass(@Param('id') id: string, @Body() body: { memoryClass: MemoryClass }) {
    return this.events.updateClass(id, body.memoryClass)
  }

  @Get(':id/why')
  @ApiOperation({ summary: 'Trilha de causalidade: quais sínteses e versões de doc usaram este evento' })
  async why(@Param('id') id: string) {
    const [syntheses, docVersions] = await Promise.all([
      this.prisma.sessionArtifact.findMany({
        where: { sourceIds: { array_contains: id } },
        orderBy: { createdAt: 'desc' },
        select: { id: true, type: true, sessionId: true, projectId: true, createdAt: true,
          content: true },
      }),
      this.prisma.projectDocumentVersion.findMany({
        where: { sourceIds: { array_contains: id } },
        orderBy: { createdAt: 'desc' },
        select: { id: true, reason: true, diff: true, createdAt: true,
          document: { select: { type: true, projectId: true } } },
      }),
    ])
    return { eventId: id, syntheses, docVersions }
  }

  @Get()
  @ApiOperation({ summary: 'Listar eventos com filtros opcionais' })
  findAll(
    @Query('project_id') projectId?: string,
    @Query('source') source?: string,
    @Query('type') type?: string,
    @Query('memory_class') memoryClass?: string,
    @Query('limit') limit?: string,
  ) {
    return this.events.findAll({ projectId, source, type, memoryClass, limit: limit ? parseInt(limit) : undefined })
  }

  @Get('hook-metrics')
  @ApiOperation({ summary: 'Latência do context hook (UserPromptSubmit) — p50/p95/p99 em ms' })
  async hookMetrics(@Query('days') daysStr = '7') {
    const days = Math.min(Math.max(parseInt(daysStr, 10) || 7, 1), 90)
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000)

    const rows = await this.prisma.$queryRaw<Array<{
      p50: number | null; p95: number | null; p99: number | null
      avg_ms: number | null; n: bigint; cache_hits: bigint; ce_p50: number | null
    }>>`
      SELECT
        percentile_cont(0.50) WITHIN GROUP (ORDER BY (metadata->>'hookDurationMs')::float) AS p50,
        percentile_cont(0.95) WITHIN GROUP (ORDER BY (metadata->>'hookDurationMs')::float) AS p95,
        percentile_cont(0.99) WITHIN GROUP (ORDER BY (metadata->>'hookDurationMs')::float) AS p99,
        round(avg((metadata->>'hookDurationMs')::float)::numeric, 1)                        AS avg_ms,
        count(*)                                                                              AS n,
        count(*) FILTER (WHERE (metadata->>'cacheHit')::boolean = true)                     AS cache_hits,
        percentile_cont(0.50) WITHIN GROUP (
          ORDER BY (metadata->>'contextEngineDurationMs')::float
        ) FILTER (WHERE
          metadata->>'contextEngineDurationMs' IS NOT NULL
          AND metadata->>'contextEngineDurationMs' != 'null'
        ) AS ce_p50
      FROM events
      WHERE source = 'cli'
        AND content = 'hook-timing'
        AND ts > ${cutoff}
    `

    const row = rows[0] ?? {}
    const n = Number(row.n ?? 0)
    const cacheHits = Number(row.cache_hits ?? 0)

    return {
      period: `last ${days}d`,
      n,
      cacheHitRate: n > 0 ? Math.round((cacheHits / n) * 100) / 100 : 0,
      total: {
        p50:  row.p50  != null ? Math.round(row.p50)  : null,
        p95:  row.p95  != null ? Math.round(row.p95)  : null,
        p99:  row.p99  != null ? Math.round(row.p99)  : null,
        avgMs: row.avg_ms != null ? Number(row.avg_ms) : null,
      },
      contextEngine: {
        p50: row.ce_p50 != null ? Math.round(row.ce_p50) : null,
      },
    }
  }

  @Get('hook/health')
  @ApiOperation({ summary: 'Saúde do hook: última vez que cada projeto recebeu evento via CLI' })
  async hookHealth() {
    const projects = await this.prisma.project.findMany({
      where: { status: 'active' },
      select: { id: true, name: true, repoSlug: true },
    })

    const STALE_MS = 2 * 24 * 60 * 60 * 1000  // 2 dias

    const rows = await Promise.all(projects.map(async (p) => {
      const last = await this.prisma.event.findFirst({
        where: { projectId: p.id, source: 'cli' },
        orderBy: { ts: 'desc' },
        select: { ts: true },
      })
      const lastTs = last?.ts ?? null
      const ageMs  = lastTs ? Date.now() - new Date(lastTs).getTime() : null
      return {
        projectId:    p.id,
        name:         p.name,
        repoSlug:     p.repoSlug,
        lastCliEvent: lastTs,
        ageDays:      ageMs !== null ? Math.floor(ageMs / (24 * 60 * 60 * 1000)) : null,
        status:       lastTs === null ? 'never' : (ageMs! > STALE_MS ? 'stale' : 'healthy'),
      }
    }))

    // Contar eventos órfãos (sem projectId) das últimas 48h — sinal de hook quebrado
    const orphans = await this.prisma.event.count({
      where: {
        source: 'cli',
        projectId: null,
        ts: { gte: new Date(Date.now() - STALE_MS) },
      },
    })

    return {
      checkedAt: new Date().toISOString(),
      orphanEventsLast48h: orphans,
      projects: rows.sort((a, b) => (a.ageDays ?? 9999) - (b.ageDays ?? 9999)),
    }
  }
}
