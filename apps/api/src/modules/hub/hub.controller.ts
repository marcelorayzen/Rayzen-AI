import { BadRequestException, Body, Controller, ForbiddenException, Get, Headers, HttpCode, Param, Post, Query, Req, Res } from '@nestjs/common'
import { ApiOperation, ApiTags } from '@nestjs/swagger'
import type { FastifyReply } from 'fastify'
import type { RequestWithPrincipal } from '../auth/principal'
import { HubTurnService } from './hub-turn.service'
import { HubWorkItemService } from './hub-work-item.service'

@ApiTags('hub')
@Controller('hub')
export class HubController {
  constructor(private readonly turns: HubTurnService, private readonly workItemService?: HubWorkItemService) {}

  @Get('work-items')
  workItems(@Query('projectId') projectId: string | undefined, @Req() request: RequestWithPrincipal) {
    const principal = request.rayzenPrincipal
    if (!principal || principal.type !== 'human') throw new ForbiddenException()
    return this.workItemService!.list(principal.id, projectId?.trim())
  }

  @Post('work-items')
  linkWorkItem(@Query('projectId') projectId: string | undefined, @Body() body: { kind?: string; sourceSystem?: string; sourceId?: string }, @Req() request: RequestWithPrincipal) {
    const principal = request.rayzenPrincipal
    if (!principal || principal.type !== 'human') throw new ForbiddenException()
    if (!projectId?.trim()) throw new BadRequestException({ code: 'hub_project_required' })
    if (!body?.kind || !body?.sourceSystem || !body?.sourceId) throw new BadRequestException({ code: 'hub_work_item_required' })
    if (body.kind !== 'project_handoff' || body.sourceSystem !== 'v1') throw new BadRequestException({ code: 'hub_work_item_source_unsupported' })
    return this.workItemService!.link(principal.id, projectId.trim(), { kind: body.kind, sourceSystem: body.sourceSystem, sourceId: body.sourceId })
  }

  @Get('work-items/reconcile/handoffs')
  unlinkedHandoffs(@Query('projectId') projectId: string | undefined, @Req() request: RequestWithPrincipal) {
    const principal = request.rayzenPrincipal
    if (!principal || principal.type !== 'human') throw new ForbiddenException()
    if (!projectId?.trim()) throw new BadRequestException({ code: 'hub_project_required' })
    return this.workItemService!.unlinkedHandoffs(projectId.trim())
  }

  @Get('work-items/linked/handoffs')
  linkedHandoffs(@Query('projectId') projectId: string | undefined, @Req() request: RequestWithPrincipal) {
    const principal = request.rayzenPrincipal
    if (!principal || principal.type !== 'human') throw new ForbiddenException()
    if (!projectId?.trim()) throw new BadRequestException({ code: 'hub_project_required' })
    return this.workItemService!.linkedHandoffs(principal.id, projectId.trim())
  }

  @Post('work-items/:itemId/open-delivery')
  @HttpCode(200)
  @ApiOperation({ summary: 'Abre a entrega confirmada deste item num worktree ao lado, no PC (item 7.2a)' })
  openDelivery(@Param('itemId') itemId: string, @Query('projectId') projectId: string | undefined, @Req() request: RequestWithPrincipal) {
    const principal = request.rayzenPrincipal
    if (!principal || principal.type !== 'human') throw new ForbiddenException()
    if (!projectId?.trim()) throw new BadRequestException({ code: 'hub_project_required' })
    return this.workItemService!.abrirEntrega(principal.id, projectId.trim(), itemId)
  }

  @Post('turns')
  @HttpCode(200)
  @ApiOperation({ summary: 'Envia texto ao Hermes pelo Hub, sem expor credencial do runtime' })
  submit(
    @Body() body: { text?: string; contextPackId?: string; novaConversa?: boolean; modo?: 'sync' | 'async'; anexoIds?: unknown; porVoz?: boolean },
    @Query('projectId') projectId: string | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: RequestWithPrincipal,
    @Headers('authorization') authorization?: string,
    @Res({ passthrough: true }) reply?: FastifyReply,
  ) {
    const principal = request.rayzenPrincipal
    if (!principal || principal.type !== 'human') throw new ForbiddenException()
    // HC2: lista de ids de `/hub/anexos`. Com anexo, o texto pode vir vazio (só o print).
    const anexoIds = Array.isArray(body?.anexoIds)
      ? body.anexoIds.filter((i): i is string => typeof i === 'string' && i.trim().length > 0)
      : []
    if (body?.anexoIds !== undefined && (!Array.isArray(body.anexoIds) || anexoIds.length !== body.anexoIds.length)) {
      throw new BadRequestException({ code: 'hub_anexo_ids_invalidos' })
    }
    const text = body?.text?.trim() ?? ''
    if (!text && !anexoIds.length) throw new BadRequestException({ code: 'hub_text_required' })
    if (text.length > 40_000) throw new BadRequestException({ code: 'hub_text_too_large' })
    const modoAsync = body.modo === 'async'
    if (modoAsync) reply?.status(202)
    return this.turns.submit({
      principalId: principal.id,
      projectId: projectId?.trim() || null,
      text,
      idempotencyKey,
      contextPackId: body.contextPackId?.trim(),
      authorization,
      novaConversa: body.novaConversa === true,
      ...(modoAsync ? { modo: 'async' as const } : {}),
      ...(anexoIds.length ? { anexoIds } : {}),
      // HC7c: só `true` de verdade liga a resposta curta; "true" em texto ou 1 não.
      ...(body.porVoz === true ? { porVoz: true } : {}),
    })
  }

  @Get('turns/:turnId')
  @ApiOperation({ summary: 'Estado persistido de um turno Hub' })
  getTurn(@Param('turnId') turnId: string, @Req() request: RequestWithPrincipal) {
    const principal = request.rayzenPrincipal
    if (!principal || principal.type !== 'human') throw new ForbiddenException()
    return this.turns.get(principal.id, turnId)
  }

  @Get('turns/:turnId/events')
  @ApiOperation({ summary: 'Eventos persistidos do turno Hub para replay/reconexão' })
  events(@Param('turnId') turnId: string, @Req() request: RequestWithPrincipal) {
    const principal = request.rayzenPrincipal
    if (!principal || principal.type !== 'human') throw new ForbiddenException()
    return this.turns.events(principal.id, turnId)
  }
}
