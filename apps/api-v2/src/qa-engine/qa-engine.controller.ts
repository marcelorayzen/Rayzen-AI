import { Controller, Get, Post, Body, Param, UseGuards, HttpCode } from '@nestjs/common'
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger'
import { IsString, IsNotEmpty, IsNumber, Min, Max } from 'class-validator'
import { ApiProperty } from '@nestjs/swagger'
import { QaEngineService } from './qa-engine.service'
import { JwtAuthGuard } from '../core/auth.guard'

class RunGateDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  projectId!: string
}

class SetSlaDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  projectId!: string

  @ApiProperty({ minimum: 0, maximum: 1 })
  @IsNumber() @Min(0) @Max(1)
  minPassRate!: number

  @ApiProperty({ minimum: 0, maximum: 1 })
  @IsNumber() @Min(0) @Max(1)
  maxFlakeRate!: number

  @ApiProperty()
  @IsNumber() @Min(0)
  maxDurationMs!: number
}

@ApiTags('qa')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('qa')
export class QaEngineController {
  constructor(private readonly qa: QaEngineService) {}

  @Post('run/:missionId')
  @HttpCode(200)
  run(@Param('missionId') missionId: string, @Body() dto: RunGateDto) {
    return this.qa.runGate(missionId, dto.projectId)
  }

  @Get('trend/:projectId')
  trend(@Param('projectId') projectId: string) {
    return this.qa.getTrend(projectId)
  }

  @Get('sla/:projectId')
  getSla(@Param('projectId') projectId: string) {
    return this.qa.getSla(projectId)
  }

  @Post('sla/:projectId')
  @HttpCode(200)
  setSla(@Param('projectId') projectId: string, @Body() dto: SetSlaDto) {
    return this.qa.setSla({ ...dto, projectId })
  }
}
