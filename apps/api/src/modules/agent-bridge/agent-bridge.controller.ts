import { Controller, Get, Post, Patch, Param, Body, Query, UseGuards } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { SkipThrottle } from '@nestjs/throttler'
import { AgentBridgeService } from './agent-bridge.service'
import { AuditLogService } from './audit-log.service'
import { AgentHeartbeatService } from './agent-heartbeat.service'
import { AgentTokenGuard } from './agent-token.guard'
import { Public } from '../auth/public.decorator'
import { MetricsService } from '../metrics/metrics.service'
import { AgentRole, TaskStatus } from '@rayzen/types'
import { IsString, IsOptional, IsBoolean, IsNumber, IsIn } from 'class-validator'
import { Transform } from 'class-transformer'

class UpdateTaskDto {
  @IsString() status!: TaskStatus
  @IsOptional() result?: unknown
  @IsOptional() @IsString() error?: string

  // Audit fields — enviados pelo agent ao completar/falhar
  @IsOptional() @IsString() module?: string
  @IsOptional() @IsString() action?: string
  @IsOptional() @IsString() command?: string
  @IsOptional() @IsString() @IsIn(['low', 'medium', 'high']) risk?: string
  @IsOptional() @IsBoolean() @Transform(({ value }) => value === true || value === 'true') dryRun?: boolean
  @IsOptional() @IsNumber() durationMs?: number
  @IsOptional() @IsString() workspace?: string
  @IsOptional() @IsString() hostname?: string
  @IsOptional() @IsString() targetRole?: string
  @IsOptional() @IsString() actor?: string
  // Item C.3 do plano de execução tipada — quem aprovou, quando a execução consumiu uma
  // aprovação de verdade. Vem do RESULTADO da execução (`RunCommandResult.aprovadoPor`), não
  // do payload de entrada — a identidade só existe depois que o servidor de aprovações a deu.
  @IsOptional() @IsString() approvedBy?: string
}

@Public()
@SkipThrottle()
@ApiTags('agent')
@UseGuards(AgentTokenGuard)
@Controller('tasks')
export class AgentBridgeController {
  constructor(
    private readonly svc: AgentBridgeService,
    private readonly audit: AuditLogService,
    private readonly metrics: MetricsService,
    private readonly heartbeat: AgentHeartbeatService,
  ) {}

  @Post()
  create(@Body() dto: { module: string; action: string; payload: Record<string, unknown>; targetRole?: AgentRole }) {
    return this.svc.enqueue(dto as import('@rayzen/types').TaskCreateDto)
  }

  @Get('pending')
  getPending(@Query('role') role?: AgentRole) {
    if (role) this.heartbeat.touch(role)
    return this.svc.getPending(role)
  }

  @Post('claim')
  async claim(@Body() dto: { role?: AgentRole; hostname?: string }) {
    if (dto.role) this.heartbeat.touch(dto.role)
    // A05: o `hostname` já vinha no corpo e era ignorado. É ele que identifica o dono da posse —
    // sem isso, qualquer agent renovaria a posse de qualquer outro.
    return this.svc.claimTask(dto.role, dto.hostname)
  }

  /**
   * A05: "ainda estou executando". O executor renova a posse periodicamente; parar de renovar é
   * o que permite reconhecer que ele morreu, sem depender de um teto de duração que não existe
   * (uma sessão supervisionada dura horas, um `screenshot` dura segundos).
   *
   * `{ ok: false }` quando a posse já foi perdida — quem executa pode usar isso para saber que
   * o trabalho deixou de ser seu. Não é erro HTTP: é resposta legítima.
   */
  @Post(':id/heartbeat')
  async heartbeatDaTarefa(@Param('id') id: string, @Body() dto: { hostname?: string; role?: AgentRole }) {
    if (dto.role) this.heartbeat.touch(dto.role)
    const ok = await this.svc.renovarPosse(id, dto.hostname)
    return { ok }
  }

  @Get(':id')
  getById(@Param('id') id: string) { return this.svc.getById(id) }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateTaskDto) {
    await this.svc.updateStatus(id, dto.status, dto.result, dto.error)

    // Grava audit entry + incrementa métricas quando a execução termina
    if (dto.status === 'done' || dto.status === 'failed') {
      const taskStatus = dto.status === 'done' ? 'success' : 'error'

      if (dto.module && dto.action) {
        await this.audit.create({
          taskId: id,
          actor: dto.actor,
          module: dto.module,
          action: dto.action,
          command: dto.command,
          risk: dto.risk,
          dryRun: dto.dryRun,
          durationMs: dto.durationMs,
          status: taskStatus,
          result: dto.result,
          error: dto.error,
          workspace: dto.workspace,
          hostname: dto.hostname,
          targetRole: dto.targetRole,
          approvedBy: dto.approvedBy,
        }).catch(() => null) // audit nunca deve quebrar o fluxo principal
      }

      this.metrics.agentTasksTotal.inc({
        action: dto.action ?? 'unknown',
        status: taskStatus,
        role: dto.targetRole ?? 'unknown',
      })
      if (dto.durationMs) {
        this.metrics.agentTaskDuration.observe(
          { action: dto.action ?? 'unknown', risk: dto.risk ?? 'unknown' },
          dto.durationMs / 1000,
        )
      }
    }

    return { ok: true }
  }

  @Get('audit')
  getAudit(
    @Query('action') action?: string,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
  ) {
    return this.audit.findAll({ action, status, limit: limit ? Number(limit) : 100 })
  }
}
