import { BadRequestException, Body, Controller, ForbiddenException, Get, HttpCode, Param, Post, Query, Req } from '@nestjs/common'
import { ApiOperation, ApiTags } from '@nestjs/swagger'
import { createHash } from 'crypto'
import type { RequestWithPrincipal } from '../auth/principal'
import { AprovacaoPeloHubService } from './aprovacao-pelo-hub.service'
import { HandoffService } from './handoff.service'

/**
 * A porta HUMANA de aprovação de envelope (13/11). Sem `@Public()`: o `JwtAuthGuard` global
 * autentica, e aqui só passa principal `human` — o `AGENT_TOKEN` vira `service:agent` e é
 * recusado antes de qualquer outra coisa. O código do autenticador é a segunda metade.
 */
@ApiTags('hub')
@Controller('hub/handoffs')
export class AprovacaoPeloHubController {
  constructor(
    private readonly aprovacao: AprovacaoPeloHubService,
    private readonly handoffs: HandoffService,
  ) {}

  private humano(request: RequestWithPrincipal) {
    const p = request.rayzenPrincipal
    if (!p || p.type !== 'human') throw new ForbiddenException('Só uma pessoa aprova envelope')
    return p
  }

  @Get('pendentes')
  @ApiOperation({ summary: 'Envelopes aguardando aprovação, com o conteúdo inteiro' })
  pendentes(@Query('projectId') projectId: string | undefined, @Req() request: RequestWithPrincipal) {
    this.humano(request)
    return this.aprovacao.pendentes(projectId?.trim() || undefined)
  }

  @Post(':id/aprovar')
  @HttpCode(200)
  @ApiOperation({ summary: 'Aprova e materializa — o código do autenticador só é cobrado no nível crítico' })
  aprovar(
    @Param('id') id: string,
    @Body() body: { codigo?: string; contentHash?: string },
    @Req() request: RequestWithPrincipal,
  ) {
    const p = this.humano(request)
    if (!body?.contentHash) throw new BadRequestException('contentHash do que você viu é obrigatório')
    return this.aprovacao.aprovar(id, p, body.codigo, body.contentHash)
  }

  @Post(':id/rejeitar')
  @HttpCode(200)
  @ApiOperation({ summary: 'Rejeita o envelope (não exige código: recusar não autoriza nada)' })
  rejeitar(@Param('id') id: string, @Body() body: { motivo?: string }, @Req() request: RequestWithPrincipal) {
    this.humano(request)
    return this.aprovacao.rejeitar(id, body?.motivo)
  }

  @Get('resumo')
  @ApiOperation({ summary: 'O que fiz sozinho, o que proponho e o que precisa de você (S1)' })
  resumo(@Query('projectId') projectId: string | undefined, @Req() request: RequestWithPrincipal) {
    this.humano(request)
    return this.handoffs.resumo(projectId?.trim() || undefined)
  }

  @Post(':id/descartar')
  @HttpCode(200)
  @ApiOperation({ summary: 'Descarta envelope parado: efeito incerto conferido, ou aceite que não vai rodar' })
  descartar(@Param('id') id: string, @Req() request: RequestWithPrincipal) {
    const p = this.humano(request)
    // Identidade derivada, como na aprovação: o motivo gravado não expõe o login.
    return this.handoffs.descartar(id, { id: `hub:${createHash('sha256').update(p.id).digest('hex').slice(0, 12)}` })
  }

  /**
   * G3.2 (24/11): a sessão que o executor largou no meio continua num envelope novo, na mesma
   * pasta e no mesmo ramo. O toque é a aprovação da continuação — por isso só pessoa, e com o
   * mesmo principal que a aprovação pelo Hub grava (`hub:<hash>`).
   */
  @Post(':id/retomar-sessao')
  @HttpCode(200)
  @ApiOperation({ summary: 'Continua a sessão interrompida de um envelope incerto, sem refazer o trabalho salvo' })
  retomarSessao(@Param('id') id: string, @Req() request: RequestWithPrincipal) {
    const p = this.humano(request)
    const quem = createHash('sha256').update(p.id).digest('hex').slice(0, 12)
    return this.handoffs.retomarInterrompida(id, { id: `hub:${quem}`, type: 'human' })
  }

  /** Retomar não é aprovar de novo: se o aceite venceu, o envelope volta ao card pedindo aprovação. */
  @Post(':id/retomar')
  @HttpCode(200)
  @ApiOperation({ summary: 'Tenta materializar de novo um envelope aprovado que parou' })
  async retomar(@Param('id') id: string, @Req() request: RequestWithPrincipal) {
    this.humano(request)
    try {
      return { materializado: true, resultado: await this.handoffs.materializar(id) }
    } catch (e) {
      return { materializado: false, motivo: (e as Error).message }
    }
  }
}
