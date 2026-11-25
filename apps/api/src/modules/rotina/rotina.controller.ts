import { Body, Controller, ForbiddenException, Get, Param, Post, Query, Req } from '@nestjs/common'
import { ApiOperation, ApiTags } from '@nestjs/swagger'
import { IsInt, IsObject, IsOptional, IsString } from 'class-validator'
import type { RequestWithPrincipal } from '../auth/principal'
import { RotinaService } from './rotina.service'
import { RotinaDisparoService } from './rotina-disparo.service'
import { RotinaGatilhoService, type EventoDoGithubParaRotina } from './rotina-gatilho.service'

/**
 * Só os campos estruturados que o `webhook-rotinas.mjs` extrai; com `whitelist: true` do
 * ValidationPipe global, qualquer outro campo (título ou corpo do PR, por exemplo) é descartado
 * antes de chegar ao service.
 */
class EventoDoGithubDto {
  @IsString() evento!: string
  @IsString() repo!: string
  @IsOptional() @IsString() autor?: string
  @IsOptional() @IsInt() numero?: number
  @IsOptional() @IsString() ramo?: string
  @IsOptional() @IsString() sha?: string
  @IsOptional() @IsString() workflow?: string
  @IsOptional() @IsString() url?: string
}

class CriarRotinaDto {
  @IsString() projectId!: string
  @IsString() nome!: string
  @IsObject() gatilho!: Record<string, unknown>
  @IsObject() modelo!: Record<string, unknown>
}

/**
 * G6.1. Criar é aberto a qualquer principal autenticado (o Hub propõe pela ferramenta MCP, na
 * fatia 7), porque toda rotina nasce `proposta` e não faz nada até uma pessoa aprovar. Aprovar e
 * retomar exigem principal HUMANO: são os dois atos que fazem a rotina disparar sozinha. Pausar não
 * exige, porque só reduz efeito.
 */
@ApiTags('rotinas')
@Controller('rotinas')
export class RotinaController {
  constructor(
    private readonly svc: RotinaService,
    private readonly disparo: RotinaDisparoService,
    private readonly gatilho: RotinaGatilhoService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Propor uma rotina (nasce sempre como proposta)' })
  criar(@Body() body: CriarRotinaDto, @Req() req: RequestWithPrincipal) {
    return this.svc.criar(body, req.rayzenPrincipal?.id ?? 'desconhecido')
  }

  @Get()
  @ApiOperation({ summary: 'Listar rotinas com as últimas 20 execuções' })
  listar(@Query('projectId') projectId?: string) {
    return this.svc.listar(projectId || undefined)
  }

  @Post(':id/aprovar')
  @ApiOperation({ summary: 'Aprovar a rotina — só principal humano' })
  aprovar(@Param('id') id: string, @Req() req: RequestWithPrincipal) {
    return this.svc.aprovar(id, this.humano(req))
  }

  @Post(':id/pausar')
  @ApiOperation({ summary: 'Pausar a rotina' })
  pausar(@Param('id') id: string) {
    return this.svc.pausar(id)
  }

  @Post(':id/retomar')
  @ApiOperation({ summary: 'Retomar a rotina — só principal humano' })
  retomar(@Param('id') id: string, @Req() req: RequestWithPrincipal) {
    this.humano(req)
    return this.svc.retomar(id)
  }

  /**
   * "Testar agora" (do Grok): dispara já, pulando só a espera da agenda. Continua respeitando os
   * limites e continua criando um envelope que precisa de aprovação — não executa nada.
   */
  @Post(':id/testar')
  @ApiOperation({ summary: 'Disparar a rotina agora (cria envelope para aprovação) — só principal humano' })
  testar(@Param('id') id: string, @Req() req: RequestWithPrincipal) {
    this.humano(req)
    return this.disparo.disparar(id, { tipo: 'manual' })
  }

  /**
   * G6, fatia 6: evento do GitHub, chamado pelo `mcp-http` depois de conferir a assinatura do
   * webhook das rotinas. Serviço pode chamar: o resultado é, no máximo, um envelope para aprovação.
   */
  @Post('gatilho/github')
  @ApiOperation({ summary: 'Evento do GitHub para as rotinas (interno, chamado pelo mcp-http)' })
  gatilhoGithub(@Body() body: EventoDoGithubDto) {
    return this.gatilho.receber(body as EventoDoGithubParaRotina)
  }

  /** O `AGENT_TOKEN` e qualquer serviço ficam de fora, como no `/stop` da sessão (G2.8). */
  private humano(req: RequestWithPrincipal): string {
    const principal = req.rayzenPrincipal
    if (!principal || principal.type !== 'human') throw new ForbiddenException()
    return principal.id
  }
}
