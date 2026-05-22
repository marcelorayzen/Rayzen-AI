import { Controller, Get, Post, Patch, Body, Query, Param, Inject, forwardRef } from '@nestjs/common'
import { ApiTags, ApiOperation } from '@nestjs/swagger'
import { EventService, CreateEventDto, MemoryClass } from './event.service'
import { SynthesisService } from '../synthesis/synthesis.service'
import { PrismaService } from '../../prisma/prisma.service'
import { MemoryService } from '../memory/memory.service'

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
  // Campos de evento direto (MCP rayzen_add_event)
  content?: string
  source?: string
  type?: string
  intent?: string
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
    // Resolve projectId: UUID explícito > busca por nome > undefined
    let projectId = payload.projectId ?? undefined
    if (!projectId && payload.projectName) {
      const found = await this.prisma.project.findFirst({
        where: { name: { equals: payload.projectName, mode: 'insensitive' } },
        select: { id: true },
      })
      if (found) projectId = found.id
    }

    // Evento direto via MCP (rayzen_add_event): tem content mas não tem hook_event_name/tool_name
    if (payload.content && !payload.hook_event_name && !payload.tool_name) {
      return this.events.create({
        projectId,
        source: 'manual',
        type: (payload.type as CreateEventDto['type']) ?? 'note',
        intent: payload.intent as CreateEventDto['intent'],
        content: payload.content,
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
}
