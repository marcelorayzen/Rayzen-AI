import { Body, Controller, Get, Post, Query, Req, UnauthorizedException, UseGuards } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { ApiOperation, ApiTags } from '@nestjs/swagger'
import { AgentTokenGuard } from '../agent-bridge/agent-token.guard'
import { Public } from '../auth/public.decorator'
import { ApprovalTokenGuard, type Principal } from './approval-token.guard'
import { ApprovalService } from './approval.service'

interface AlvoDto {
  actionKey: string
  actor:     string
  resource?: string
  args?:     Record<string, unknown>
}

/**
 * `createdBy` NAO existe mais no corpo, de proposito.
 *
 * Ele era um campo de auditoria preenchido por quem esta sendo auditado: bastava mandar
 * `createdBy: "marcelo"` para o registro dizer que Marcelo aprovou. Agora a identidade e
 * derivada do principal que o guard autenticou, e o corpo nao tem como influencia-la.
 */
type CriarDto = Omit<AlvoDto, never> & { validadeMs?: number }

/**
 * Aprovação de execução de risco alto — Fase 5-A de `docs/plano-execucao-tipada.md`.
 *
 * **Os dois verbos usam guards diferentes, e essa é a peça inteira.** Criar exige
 * `APPROVAL_TOKEN`, que o agent não tem; consumir exige `AGENT_TOKEN`, que ele tem. Com um guard
 * só, o agent alcançaria as duas rotas e a "aprovação humana" seria uma volta a mais no mesmo
 * lugar — exatamente o que o `force: true` era.
 */
/**
 * `@Public()` desliga o `JwtAuthGuard` **global**, não a autenticação: cada rota abaixo declara
 * o próprio guard, e é ele a autoridade. Sem isto a criação era impossível em produção — medido
 * em 2026-09-08, HTTP 401 antes de chegar ao `ApprovalTokenGuard`, porque `APPROVAL_TOKEN` é um
 * hex de 64 e não um JWT. Falhava fechado, que é o lado certo, mas fechado para todos.
 *
 * Mesmo padrão do `agent-bridge.controller.ts`. E o risco dele é conhecido: `@Public()` sem
 * guard por rota abriria tudo — por isso há teste que exige as duas coisas juntas.
 */
@ApiTags('execution')
@Public()
@Controller('execution/approvals')
export class ApprovalController {
  constructor(private readonly svc: ApprovalService) {}

  @Post()
  @UseGuards(ApprovalTokenGuard)
  @ApiOperation({ summary: 'Cria aprovação humana — exige APPROVAL_TOKEN, que o agent não possui' })
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  criar(@Body() dto: CriarDto, @Req() req: { principal?: Principal }) {
    // Sem principal a rota nao deveria ter sido alcancada — mas se o guard mudar e parar de
    // preenche-lo, isto FECHA em vez de gravar uma auditoria anonima.
    const principal = req.principal
    if (!principal) throw new UnauthorizedException('principal ausente — guard não autenticou')

    return this.svc.criar(
      { actionKey: dto.actionKey, actor: dto.actor, resource: dto.resource, args: dto.args ?? {} },
      principal,
      dto.validadeMs,
    )
  }

  /**
   * Limite mais apertado que o global: consumo e a superficie que um chamador hostil usaria
   * para VARRER combinacoes de argumentos ate acertar uma aprovacao valida. O motivo generico
   * da recusa ja nao ajuda a enumerar; o rate limit fecha a forca bruta.
   */
  @Post('consume')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @UseGuards(AgentTokenGuard)
  @ApiOperation({ summary: 'Consome aprovação para um alvo exato — uma vez só' })
  consumir(@Body() dto: AlvoDto & { taskId?: string }) {
    return this.svc.consumir(
      { actionKey: dto.actionKey, actor: dto.actor, resource: dto.resource, args: dto.args ?? {} },
      dto.taskId,
    )
  }

  @Get('pending')
  @UseGuards(AgentTokenGuard)
  @ApiOperation({ summary: 'Aprovações válidas e ainda não consumidas' })
  pendentes(@Query('actionKey') actionKey?: string) {
    return this.svc.listarPendentes(actionKey)
  }
}
