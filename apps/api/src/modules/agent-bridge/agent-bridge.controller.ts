import { Controller, Get, Patch, Param, Body, Query, UseGuards } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { SkipThrottle } from '@nestjs/throttler'
import { AgentBridgeService } from './agent-bridge.service'
import { AgentTokenGuard } from './agent-token.guard'
import { AgentRole, TaskStatus } from '@rayzen/types'
import { IsString, IsOptional } from 'class-validator'

class UpdateTaskDto {
  @IsString() status!: TaskStatus
  @IsOptional() result?: unknown
  @IsOptional() @IsString() error?: string
}

@SkipThrottle()
@ApiTags('agent')
@UseGuards(AgentTokenGuard)
@Controller('tasks')
export class AgentBridgeController {
  constructor(private readonly svc: AgentBridgeService) {}

  @Get('pending')
  getPending(@Query('role') role?: AgentRole) { return this.svc.getPending(role) }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateTaskDto) {
    return this.svc.updateStatus(id, dto.status, dto.result, dto.error)
  }
}
