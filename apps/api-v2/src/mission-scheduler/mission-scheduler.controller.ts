import { Controller, Get, Post, Param, Body, Query, UseGuards, HttpCode } from '@nestjs/common'
import { ApiTags, ApiBearerAuth, ApiQuery } from '@nestjs/swagger'
import { IsString, IsNotEmpty, IsOptional, IsIn, IsArray, IsDate } from 'class-validator'
import { Type } from 'class-transformer'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { MissionSchedulerService } from './mission-scheduler.service'
import { JwtAuthGuard } from '../core/auth.guard'

class EnqueueDto {
  @ApiProperty() @IsString() @IsNotEmpty() missionId!: string
  @ApiPropertyOptional({ enum: ['critical','high','normal','low'] })
  @IsOptional() @IsIn(['critical','high','normal','low']) priority?: 'critical'|'high'|'normal'|'low'
  @ApiPropertyOptional() @IsOptional() @IsArray() dependsOn?: string[]
  @ApiPropertyOptional() @IsOptional() @IsDate() @Type(() => Date) scheduledAt?: Date
}

class PrioritizeDto {
  @ApiProperty({ enum: ['critical','high','normal','low'] })
  @IsIn(['critical','high','normal','low']) priority!: 'critical'|'high'|'normal'|'low'
}

@ApiTags('scheduler')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('scheduler')
export class MissionSchedulerController {
  constructor(private readonly scheduler: MissionSchedulerService) {}

  @Get('status')
  status() { return this.scheduler.getStatus() }

  @Get('queue')
  @ApiQuery({ name: 'status', required: false })
  queue(@Query('status') status?: string) { return this.scheduler.getQueue(status) }

  @Get('running')
  running() { return this.scheduler.getRunning() }

  @Get('next')
  next() { return this.scheduler.getNextEligible() }

  @Post('enqueue')
  @HttpCode(200)
  enqueue(@Body() dto: EnqueueDto) { return this.scheduler.enqueue(dto) }

  @Post('missions/:id/prioritize')
  @HttpCode(200)
  prioritize(@Param('id') id: string, @Body() dto: PrioritizeDto) {
    return this.scheduler.prioritize(id, dto.priority)
  }

  @Post('missions/:id/pause')
  @HttpCode(200)
  pause(@Param('id') id: string) { return this.scheduler.pause(id) }

  @Post('missions/:id/resume')
  @HttpCode(200)
  resume(@Param('id') id: string) { return this.scheduler.resume(id) }
}
