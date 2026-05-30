import { Controller, Get, Patch, Post, Param, Body, Query, UseGuards, HttpCode } from '@nestjs/common'
import { ApiTags, ApiBearerAuth, ApiQuery } from '@nestjs/swagger'
import { IsOptional, IsNumber, Min } from 'class-validator'
import { ApiPropertyOptional } from '@nestjs/swagger'
import { ResourceManagerService } from './resource-manager.service'
import { JwtAuthGuard } from '../core/auth.guard'

class UpdateLimitsDto {
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) maxTokensPerStep?: number
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) maxTokensPerMission?: number
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(1) maxActiveAgents?: number
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(1) agentTtlMinutes?: number
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(1) maxStepRetries?: number
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(1) maxMissionDurationMinutes?: number
}

@ApiTags('resources')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('resources')
export class ResourceManagerController {
  constructor(private readonly rm: ResourceManagerService) {}

  @Get('status')
  @ApiQuery({ name: 'projectId', required: true })
  status(@Query('projectId') projectId: string) {
    return this.rm.getStatus(projectId)
  }

  @Get('limits')
  @ApiQuery({ name: 'projectId', required: true })
  getLimits(@Query('projectId') projectId: string) {
    return this.rm.getLimits(projectId)
  }

  @Patch('limits')
  @ApiQuery({ name: 'projectId', required: true })
  setLimits(@Query('projectId') projectId: string, @Body() dto: UpdateLimitsDto) {
    return this.rm.setLimits(projectId, dto)
  }

  @Post('agents/:agentId/destroy')
  @HttpCode(204)
  destroyAgent(@Param('agentId') agentId: string) {
    this.rm.destroyAgent(agentId)
  }

  @Post('sweep')
  @HttpCode(200)
  @ApiQuery({ name: 'projectId', required: true })
  sweep(@Query('projectId') projectId: string) {
    const zombies = this.rm.sweepZombies(projectId)
    return { swept: zombies.length, agentIds: zombies }
  }
}
