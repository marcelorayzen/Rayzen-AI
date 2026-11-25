import {
  Body,
  ConflictException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  ServiceUnavailableException,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common'
import { ApiOperation, ApiTags } from '@nestjs/swagger'
import { Throttle } from '@nestjs/throttler'
import { ReconciliationOutcome } from '@rayzen/types'
import { IsIn, IsNotEmpty, IsObject, IsOptional, IsString, MaxLength } from 'class-validator'
import { AgentBridgeService } from '../agent-bridge/agent-bridge.service'
import { AuditLogService } from '../agent-bridge/audit-log.service'
import { Public } from '../auth/public.decorator'
import { ApprovalTokenGuard, Principal } from './approval-token.guard'

class ReconcileTaskDto {
  @IsString()
  @IsIn(['effect_confirmed', 'effect_not_observed', 'compensated'])
  outcome!: ReconciliationOutcome

  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  reason!: string

  @IsOptional()
  @IsObject()
  evidence?: Record<string, unknown>
}

@ApiTags('execution')
@Public()
@UseGuards(ApprovalTokenGuard)
@Controller('execution/reconciliation')
export class TaskReconciliationController {
  constructor(
    private readonly tasks: AgentBridgeService,
    private readonly audit: AuditLogService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Lista tarefas com efeito incerto para decisão humana' })
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  list(@Req() req: { principal?: Principal }, @Query('limit') limit?: string) {
    this.requirePrincipal(req)
    return this.tasks.getEffectUnknown(limit ? Number(limit) : 100)
  }

  @Post(':id')
  @ApiOperation({ summary: 'Resolve effect_unknown com identidade e evidência humanas' })
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async reconcile(
    @Param('id') id: string,
    @Body() dto: ReconcileTaskDto,
    @Req() req: { principal?: Principal },
  ) {
    const principal = this.requirePrincipal(req)
    const resolution = await this.tasks.reconcileEffectUnknown(id, {
      outcome: dto.outcome,
      actor: principal.id,
      actorType: principal.type,
      reason: dto.reason,
      evidence: dto.evidence,
    })

    if (resolution.result === 'not_found') throw new NotFoundException(`Task ${id} not found`)
    if (resolution.result === 'busy') {
      throw new ServiceUnavailableException(`Task ${id} esta concluindo ou sendo reconciliada`)
    }
    if (resolution.result === 'stale') {
      throw new ConflictException(`Task ${id} nao esta em effect_unknown ou ja recebeu outra resolucao`)
    }
    if (resolution.result === 'already_applied') {
      return { ok: true, replayed: true, task: resolution.task }
    }

    const task = resolution.task!
    await this.audit.create({
      taskId: task.id,
      actor: principal.id,
      module: task.module,
      action: `${task.action}:reconcile_effect_unknown`,
      status: 'success',
      result: {
        outcome: dto.outcome,
        reason: dto.reason,
        evidence: dto.evidence,
        finalStatus: task.status,
      },
      targetRole: task.targetRole,
    }).catch(() => null)

    return { ok: true, replayed: false, task }
  }

  private requirePrincipal(req: { principal?: Principal }): Principal {
    if (!req.principal) throw new UnauthorizedException('principal ausente — guard não autenticou')
    return req.principal
  }
}
