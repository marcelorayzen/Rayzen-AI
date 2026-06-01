import { Controller, Post, Get, Body, Param } from '@nestjs/common'
import { ApiTags, ApiOperation } from '@nestjs/swagger'
import { AgentSessionService } from './agent-session.service'

@ApiTags('agent-session')
@Controller('agent/session')
export class AgentSessionController {
  constructor(private readonly svc: AgentSessionService) {}

  @Post()
  @ApiOperation({ summary: 'Criar sessão supervisionada e enfileirar task no agent' })
  create(@Body() body: { projectId: string; prompt: string }) {
    return this.svc.create(body.projectId, body.prompt)
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obter status da sessão' })
  get(@Param('id') id: string) {
    return this.svc.get(id)
  }

  @Post(':id/question')
  @ApiOperation({ summary: 'Claude fez uma pergunta ou concluiu uma etapa — notifica e aguarda resposta/aprovação' })
  postQuestion(
    @Param('id') id: string,
    @Body() body: { question: string; requiresApproval?: boolean; approvalOptions?: string[] },
  ) {
    return this.svc.postQuestion(id, body.question, body.requiresApproval, body.approvalOptions)
  }

  @Get(':id/reply')
  @ApiOperation({ summary: 'Poll: retorna pendingReply se o usuário já respondeu (e limpa o campo)' })
  pollReply(@Param('id') id: string) {
    return this.svc.pollReply(id)
  }

  @Post(':id/answer')
  @ApiOperation({ summary: 'Usuário responde/aprova pela web — equivale ao reply do Telegram' })
  async answer(@Param('id') id: string, @Body() body: { reply: string }) {
    await this.svc.submitReply(id, body.reply)
    return { ok: true }
  }

  @Post(':id/complete')
  @ApiOperation({ summary: 'Claude concluiu — envia resumo + preview URL pelo Telegram' })
  complete(@Param('id') id: string, @Body() body: { summary: string; previewUrl?: string }) {
    return this.svc.complete(id, body.summary, body.previewUrl)
  }

  @Post(':id/log')
  @ApiOperation({ summary: 'Agent envia chunk de stdout ao vivo — acumula em liveLog (últimos 6KB)' })
  appendLog(@Param('id') id: string, @Body() body: { chunk: string }) {
    return this.svc.appendLog(id, body.chunk ?? '')
  }

  @Post(':id/error')
  @ApiOperation({ summary: 'Erro crítico — notifica Telegram' })
  error(@Param('id') id: string, @Body() body: { message: string }) {
    return this.svc.error(id, body.message)
  }
}
