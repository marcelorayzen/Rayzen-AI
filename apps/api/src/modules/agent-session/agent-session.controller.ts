import { Controller, Post, Get, Body, Param, Req, ForbiddenException } from '@nestjs/common'
import { ApiTags, ApiOperation } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsNumber, IsOptional, IsString, Min, ValidateNested } from 'class-validator'
import type { RequestWithPrincipal } from '../auth/principal'
import {
  AgentSessionService, type MetricasDaSessao, type VerificacaoIndependenteDaSessao,
} from './agent-session.service'

class VerificacaoIndependenteDto implements VerificacaoIndependenteDaSessao {
  @IsIn(['passou', 'falhou', 'timeout', 'não verificado'])
  status!: VerificacaoIndependenteDaSessao['status']

  @IsString()
  comando!: string

  @IsOptional()
  @IsInt()
  codigo!: number | null

  @IsNumber()
  @Min(0)
  duracaoMs!: number

  @IsArray()
  @ArrayMaxSize(40)
  @IsString({ each: true })
  ultimasLinhas!: string[]
}

class RegistrarMetricasDto implements MetricasDaSessao {
  @IsOptional()
  @IsNumber()
  @Min(0)
  costUsd?: number

  @IsOptional()
  @IsInt()
  @Min(0)
  numTurns?: number

  @IsOptional()
  @IsString()
  modelSessionId?: string

  @IsOptional()
  @IsString()
  papel?: string

  @IsOptional()
  @IsString()
  provedor?: string

  @IsOptional()
  @IsString()
  modelo?: string

  @IsOptional()
  @ValidateNested()
  @Type(() => VerificacaoIndependenteDto)
  testVerification?: VerificacaoIndependenteDto
}

class CompletarSessaoDto {
  @IsString()
  summary!: string

  @IsOptional()
  @IsString()
  previewUrl?: string

  @IsOptional()
  @ValidateNested()
  @Type(() => VerificacaoIndependenteDto)
  testVerification?: VerificacaoIndependenteDto
}

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

  @Post(':id/stop')
  @ApiOperation({ summary: 'Solicitar parada humana da sessão supervisionada' })
  stop(@Param('id') id: string, @Req() request: RequestWithPrincipal) {
    const principal = request.rayzenPrincipal
    if (!principal || principal.type !== 'human') throw new ForbiddenException()
    return this.svc.solicitarParada(id)
  }

  @Post(':id/stopped')
  @ApiOperation({ summary: 'Registrar que o agent interrompeu a sessão' })
  stopped(@Param('id') id: string) {
    return this.svc.marcarParada(id)
  }

  @Post(':id/metrics')
  @ApiOperation({ summary: 'Somar métricas de uma etapa e atualizar a identidade do modelo' })
  registrarMetricas(@Param('id') id: string, @Body() body: RegistrarMetricasDto) {
    return this.svc.registrarMetricas(id, body)
  }

  @Post(':id/question')
  @ApiOperation({ summary: 'Claude fez uma pergunta ou concluiu uma etapa — notifica e aguarda resposta/aprovação' })
  postQuestion(
    @Param('id') id: string,
    @Body() body: { question: string; requiresApproval?: boolean; approvalOptions?: string[]; previewUrl?: string },
  ) {
    return this.svc.postQuestion(id, body.question, body.requiresApproval, body.approvalOptions, body.previewUrl)
  }

  @Get(':id/reply')
  @ApiOperation({ summary: 'Poll: retorna pendingReply se o usuário já respondeu (e limpa o campo)' })
  pollReply(@Param('id') id: string) {
    return this.svc.pollReply(id)
  }

  @Post(':id/answer')
  @ApiOperation({ summary: 'Usuário responde/aprova pela web — equivale ao reply do Telegram' })
  async answer(@Param('id') id: string, @Body() body: { reply: string }, @Req() request: RequestWithPrincipal) {
    // 21/11: quem respondeu vai junto — uma recusa de publicação fica registrada com o nome.
    await this.svc.submitReply(id, body.reply, request.rayzenPrincipal?.id)
    return { ok: true }
  }

  @Post(':id/complete')
  @ApiOperation({ summary: 'Claude concluiu — envia resumo + preview URL pelo Telegram' })
  complete(@Param('id') id: string, @Body() body: CompletarSessaoDto) {
    return this.svc.complete(id, body.summary, body.previewUrl, body.testVerification)
  }

  @Post(':id/log')
  @ApiOperation({ summary: 'Agent envia chunk de stdout ao vivo — acumula em liveLog (últimos 6KB)' })
  appendLog(@Param('id') id: string, @Body() body: { chunk: string; vscodeUrl?: string }) {
    return this.svc.appendLog(id, body.chunk ?? '', typeof body.vscodeUrl === 'string' ? body.vscodeUrl : undefined)
  }

  @Post(':id/error')
  @ApiOperation({ summary: 'Erro crítico — notifica Telegram' })
  error(@Param('id') id: string, @Body() body: { message: string }) {
    return this.svc.error(id, body.message)
  }
}
