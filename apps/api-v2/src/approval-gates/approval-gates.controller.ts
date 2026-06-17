import { Controller, Get, Post, Body, Param, Query, UseGuards, HttpCode } from '@nestjs/common'
import { ApiTags, ApiBearerAuth, ApiQuery } from '@nestjs/swagger'
import { IsString, IsNotEmpty, IsOptional } from 'class-validator'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { ApprovalGatesService } from './approval-gates.service'
import { MissionService } from '../mission/mission.service'
import { WorkflowEngineService } from '../workflow/workflow-engine.service'
import { JwtAuthGuard } from '../core/auth.guard'

class DecideDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  approvedBy!: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  comment?: string
}

@ApiTags('approvals')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('approvals')
export class ApprovalGatesController {
  constructor(
    private readonly gates:    ApprovalGatesService,
    private readonly missions: MissionService,
    private readonly workflow: WorkflowEngineService,
  ) {}

  @Get('pending')
  @ApiQuery({ name: 'projectId', required: false })
  @ApiQuery({ name: 'missionId', required: false })
  pending(
    @Query('projectId') projectId?: string,
    @Query('missionId') missionId?: string,
  ) {
    return this.gates.findPending(projectId, missionId)
  }

  @Get('history')
  @ApiQuery({ name: 'projectId', required: true })
  history(@Query('projectId') projectId: string) {
    return this.gates.history(projectId)
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.gates.findOne(id)
  }

  @Post(':id/approve')
  @HttpCode(200)
  async approve(@Param('id') id: string, @Body() dto: DecideDto) {
    const gate = await this.gates.approve(id, dto.approvedBy, dto.comment)
    // Retoma a missão: re-roda o DAG, que agora encontra o step desbloqueado e
    // respeita as dependências (gate→resume — antes o step ficava travado pra sempre).
    let resumed = false
    if (gate.missionId && gate.projectId) {
      resumed = true
      void this.workflow.execute(gate.missionId, gate.projectId).catch(() => null)
    }
    return { ...gate, resumed }
  }

  @Post(':id/reject')
  @HttpCode(200)
  async reject(@Param('id') id: string, @Body() dto: DecideDto) {
    const gate = await this.gates.reject(id, dto.approvedBy, dto.comment)
    // Step rejeitado → marca como failed e pausa a missão para decisão do usuário.
    if (gate.missionId && gate.stepId) {
      await this.missions
        .updateStep(gate.missionId, gate.stepId, {
          status: 'failed',
          output: { rejected: true, by: dto.approvedBy, comment: dto.comment ?? null },
        })
        .catch(() => null)
      await this.missions.transition(gate.missionId, 'paused').catch(() => null)
    }
    return gate
  }
}
