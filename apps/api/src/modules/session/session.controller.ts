import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common'
import { ApiOperation, ApiTags } from '@nestjs/swagger'
import { SessionService } from './session.service'
import { HubIngestGuard } from './hub-ingest.guard'
import { Public } from '../auth/public.decorator'

@ApiTags('session')
@Controller('sessions')
export class SessionController {
  constructor(private readonly svc: SessionService) {}

  @Get('tokens')
  getTokenStats() {
    return this.svc.getTokenStats()
  }

  @Get()
  getSessions() {
    return this.svc.getRecentSessions()
  }

  /**
   * Em qual conversa este canal deve escrever agora.
   *
   * **Precisa vir ANTES de `:sessionId/messages`** na ordem de declaração — o Nest casa rotas em
   * ordem, e `atual` bateria no parâmetro. Esta é a razão de a rota não estar no fim do arquivo.
   *
   * A política é do servidor, e é isso que faz a unificação existir: se cada canal decidisse
   * sozinho, "unificar" seria combinar três clientes a se comportarem igual — acordo, não
   * mecanismo. A web e o Telegram perguntam; a resposta é a mesma.
   */
  @Get('atual')
  @ApiOperation({ summary: 'Sessão a usar agora — retoma a recente do mesmo escopo, ou começa uma' })
  atual(@Query('projectId') projectId?: string) {
    return this.svc.sessaoAtual(projectId?.trim() || null)
  }

  /**
   * O HUB manda o turno que acabou de acontecer.
   *
   * `@Public()` + `@UseGuards(HubIngestGuard)` de propósito, e a ordem importa: o guard global roda
   * primeiro e precisa ceder, para o guard **escopado** decidir. Sem o `@Public()` a rota exigiria
   * JWT ou `AGENT_TOKEN`, e dar qualquer um dos dois ao Hermes daria a API inteira a um serviço
   * exposto na internet.
   *
   * Responde 204: quem chama é um hook de runtime, e o corpo da resposta não tem leitor.
   */
  @Public()
  @UseGuards(HubIngestGuard)
  @Post('ingest')
  @HttpCode(204)
  @ApiOperation({ summary: 'Turno do HUB → conversa (e evento, se a PESSOA declarou decisão)' })
  async ingest(@Body() dto: {
    sessionId?:         string
    userMessage?:       string
    assistantResponse?: string
    projectId?:         string
    model?:             string
  }) {
    if (!dto?.sessionId) return
    await this.svc.ingerirTurnoDoHub({
      sessionId:         dto.sessionId,
      userMessage:       dto.userMessage ?? '',
      assistantResponse: dto.assistantResponse ?? '',
      projectId:         dto.projectId?.trim() || null,
      model:             dto.model ?? null,
    })
  }

  @Get(':sessionId/messages')
  getSessionMessages(@Param('sessionId') sessionId: string) {
    return this.svc.getSessionMessages(sessionId)
  }

  @Delete(':sessionId')
  deleteSession(@Param('sessionId') sessionId: string) {
    return this.svc.deleteSession(sessionId)
  }
}
