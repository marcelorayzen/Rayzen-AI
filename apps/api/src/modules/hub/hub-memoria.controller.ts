import { Body, Controller, ForbiddenException, Get, Param, Post, Query, Req } from '@nestjs/common'
import { ApiOperation, ApiTags } from '@nestjs/swagger'
import { IsIn, IsOptional, IsString } from 'class-validator'
import type { RequestWithPrincipal } from '../auth/principal'
import { HubMemoriaService } from './hub-memoria.service'

class ProporMemoriaDto {
  @IsIn(['guardar', 'remover']) acao!: string
  @IsString() projectId!: string
  @IsOptional() @IsString() anexoId?: string
  @IsOptional() @IsString() sourcePath?: string
  @IsOptional() @IsString() titulo?: string
}

/**
 * HC4b — propostas de memória (gaveta 1, a biblioteca). Propor é aberto a qualquer principal
 * autenticado (o Hub propõe pelo MCP): o efeito máximo é um cartão esperando decisão. Aprovar e
 * rejeitar exigem pessoa — o `AGENT_TOKEN` e os serviços ficam de fora, como nas rotinas.
 */
@ApiTags('hub')
@Controller('hub/memoria/propostas')
export class HubMemoriaController {
  constructor(private readonly memoria: HubMemoriaService) {}

  @Post()
  @ApiOperation({ summary: 'Propor guardar um anexo na memória ou remover um documento (nasce proposta)' })
  propor(@Body() body: ProporMemoriaDto, @Req() req: RequestWithPrincipal) {
    return this.memoria.propor(body, req.rayzenPrincipal?.id ?? 'desconhecido')
  }

  @Get()
  @ApiOperation({ summary: 'Propostas de memória esperando decisão (ou indexando)' })
  pendentes(@Query('projectId') projectId?: string) {
    return this.memoria.pendentes(projectId || undefined)
  }

  @Post(':id/aprovar')
  @ApiOperation({ summary: 'Aprovar — só pessoa. Guardar segue em segundo plano até aprovada/falhou' })
  aprovar(@Param('id') id: string, @Req() req: RequestWithPrincipal) {
    return this.memoria.aprovar(id, this.humano(req))
  }

  @Post(':id/rejeitar')
  @ApiOperation({ summary: 'Rejeitar — só pessoa' })
  rejeitar(@Param('id') id: string, @Req() req: RequestWithPrincipal) {
    return this.memoria.rejeitar(id, this.humano(req))
  }

  private humano(req: RequestWithPrincipal): string {
    const principal = req.rayzenPrincipal
    if (!principal || principal.type !== 'human') throw new ForbiddenException()
    return principal.id
  }
}
