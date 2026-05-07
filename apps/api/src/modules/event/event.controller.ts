import { Controller, Get, Post, Patch, Body, Query, Param, Inject, forwardRef } from '@nestjs/common'
import { ApiTags, ApiOperation } from '@nestjs/swagger'
import { EventService, CreateEventDto, MemoryClass } from './event.service'
import { SynthesisService } from '../synthesis/synthesis.service'
import { PrismaService } from '../../prisma/prisma.service'
import { MemoryService } from '../memory/memory.service'

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
  projectId?: string         // injetado pelo script do hook
  git?: GitContext           // enriquecido pelo hook (Fase 9)
  fileContent?: string       // conteúdo do arquivo para indexação semântica (Edit/Write)
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
    const projectId = payload.projectId ?? undefined
    const hookEvent = payload.hook_event_name ?? 'PostToolUse'

    // Hook Stop — registra encerramento e dispara síntese em background
    if (hookEvent === 'Stop') {
      const messageCount = payload.transcript?.length ?? 0
      await this.events.create({
        projectId,
        source: 'cli',
        type: 'note',
        content: `Sessão encerrada (${messageCount} mensagens)${payload.git?.branch ? ` [${payload.git.branch}]` : ''}`,
        metadata: { sessionId: payload.session_id, messageCount, git: payload.git ?? null },
      })

      // Síntese assíncrona — não bloqueia o hook
      if (payload.session_id) {
        this.synthesis.synthesizeSession(payload.session_id, projectId)
          .catch(() => null)
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
    } else if (tool === 'Bash') {
      const cmd = String(input['command'] ?? '').slice(0, 200)
      content = `Bash: ${cmd}${gitSuffix}`
      type = 'execution'
    } else if (tool === 'Read') {
      const filePath = (input['file_path'] as string) ?? 'arquivo'
      content = `Read: ${filePath}${gitSuffix}`
      type = 'note'
    } else {
      content = `${tool}: ${JSON.stringify(input).slice(0, 150)}${gitSuffix}`
    }

    return this.events.create({
      projectId,
      source: 'cli',
      type,
      content,
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
