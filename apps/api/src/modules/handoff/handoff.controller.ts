import { Body, Controller, Get, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common'
import { ApiOperation, ApiTags } from '@nestjs/swagger'
import { Public } from '../auth/public.decorator'
import { ApprovalTokenGuard, type Principal } from '../execution/approval-token.guard'
import { AgentTokenGuard } from '../agent-bridge/agent-token.guard'
import { HandoffService } from './handoff.service'
import type { ConteudoDoHandoff, EstadoDoHandoff } from './handoff.const'

/**
 * `ProjectHandoff` — a fatia técnica da Fase 4.
 *
 * ── Aprovar e materializar usam guards DIFERENTES, e é a peça inteira ───────
 * `aprovar` exige `APPROVAL_TOKEN`, que o agent não tem; o resto exige `AGENT_TOKEN`, que ele
 * tem. Com um guard só, quem executa alcançaria a rota que autoriza — e a "aprovação humana"
 * seria uma volta a mais no mesmo lugar, que é exatamente o que o `force: true` era antes da
 * Fase 5-A. O padrão é copiado de `approval.controller.ts` de propósito.
 *
 * `@Public()` desliga o `JwtAuthGuard` global, não a autenticação: cada rota declara o próprio
 * guard, e é ele a autoridade.
 */
@ApiTags('handoff')
@Public()
@Controller('handoffs')
export class HandoffController {
  constructor(private readonly handoffs: HandoffService) {}

  @Post()
  @UseGuards(AgentTokenGuard)
  @ApiOperation({ summary: 'Cria um envelope em rascunho' })
  criar(@Body() body: ConteudoDoHandoff & { principal?: string }) {
    return this.handoffs.criar(body, body.principal ?? 'agent')
  }

  @Put(':id')
  @UseGuards(AgentTokenGuard)
  @ApiOperation({ summary: 'Edita o rascunho — sobe a versão e invalida o aceite anterior' })
  editar(@Param('id') id: string, @Body() body: ConteudoDoHandoff & { principal?: string }) {
    return this.handoffs.editar(id, body, body.principal ?? 'agent')
  }

  /** Só leitura, para o Hub responder "o que você fez?" pelo MCP — mesmo resumo da porta humana. */
  @Get('resumo')
  @UseGuards(AgentTokenGuard)
  @ApiOperation({ summary: 'O que fiz sozinho, o que proponho e o que precisa de uma pessoa' })
  resumo(@Query('projectId') projectId?: string) {
    return this.handoffs.resumo(projectId?.trim() || undefined)
  }

  @Post(':id/submit')
  @UseGuards(AgentTokenGuard)
  @ApiOperation({ summary: 'Envia o envelope para aprovação' })
  submeter(@Param('id') id: string) {
    return this.handoffs.submeter(id)
  }

  /**
   * A identidade de quem aprova vem do guard, nunca do corpo — o defeito que o
   * `approval.controller.ts` já corrigiu: `createdBy` era um campo de auditoria preenchido por
   * quem estava sendo auditado.
   */
  @Post(':id/approve')
  @UseGuards(ApprovalTokenGuard)
  @ApiOperation({ summary: 'Aprova o envelope e emite a autorização do efeito' })
  aprovar(@Param('id') id: string, @Req() req: { principal?: Principal }) {
    const p = req.principal
    return this.handoffs.aprovar(id, { id: p?.id ?? 'desconhecido', type: p?.type ?? 'desconhecido' })
  }

  @Post(':id/reject')
  @UseGuards(ApprovalTokenGuard)
  @ApiOperation({ summary: 'Rejeita o envelope' })
  rejeitar(@Param('id') id: string, @Body() body: { motivo?: string }) {
    return this.handoffs.rejeitar(id, body?.motivo)
  }

  @Post(':id/cancel')
  @UseGuards(AgentTokenGuard)
  @ApiOperation({ summary: 'Cancela o envelope enquanto nada foi executado' })
  cancelar(@Param('id') id: string, @Body() body: { motivo?: string }) {
    return this.handoffs.cancelar(id, body?.motivo)
  }

  @Post(':id/materialize')
  @UseGuards(AgentTokenGuard)
  @ApiOperation({ summary: 'Enfileira o efeito aprovado pelo broker, com chave idempotente' })
  materializar(@Param('id') id: string) {
    return this.handoffs.materializar(id)
  }

  @Get()
  @UseGuards(AgentTokenGuard)
  listar(@Query('status') status?: EstadoDoHandoff) {
    return this.handoffs.listar(status)
  }

  @Get(':id')
  @UseGuards(AgentTokenGuard)
  buscar(@Param('id') id: string) {
    return this.handoffs.buscar(id)
  }
}
