import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common'
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger'
import { IsString, IsOptional, IsBoolean, IsNumber, IsInt, Min, Max } from 'class-validator'
import { Type } from 'class-transformer'
import { JwtAuthGuard } from '../core/auth.guard'
import { BenchmarkService } from './benchmark.service'

class RunBenchmarkDto {
  @IsString()
  strategyId!: string

  @IsOptional() @IsString()
  taskType?: string

  @IsOptional() @IsBoolean()
  goldenOnly?: boolean

  @IsOptional() @IsInt() @Min(1) @Max(100)
  @Type(() => Number)
  limit?: number

  @IsOptional() @IsString()
  systemPrompt?: string

  @IsOptional() @IsString()
  model?: string
}

class ExtractFromTracesDto {
  @IsOptional() @IsInt() @Min(1) @Max(100)
  @Type(() => Number)
  limit?: number

  @IsOptional() @IsString()
  projectId?: string
}

@ApiTags('benchmark')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('benchmark')
export class BenchmarkController {
  constructor(private readonly benchmark: BenchmarkService) {}

  @Post('run')
  @ApiOperation({ summary: 'Roda benchmark para uma estratégia contra os casos cadastrados' })
  run(@Body() dto: RunBenchmarkDto) {
    return this.benchmark.runForStrategy(dto)
  }

  @Post('extract')
  @ApiOperation({ summary: 'Extrai casos candidatos a partir de TraceSpans recentes' })
  extract(@Body() dto: ExtractFromTracesDto) {
    return this.benchmark.extractFromTraces(dto.limit ?? 20, dto.projectId)
  }

  @Get('cases')
  @ApiOperation({ summary: 'Lista casos de benchmark' })
  listCases(
    @Query('taskType')    taskType?: string,
    @Query('approvedOnly') approvedOnly?: string,
    @Query('limit')       limit?: string,
  ) {
    return this.benchmark.listCases({
      taskType,
      approvedOnly: approvedOnly === 'true',
      limit:        limit ? parseInt(limit) : undefined,
    })
  }

  @Get('golden')
  @ApiOperation({ summary: 'Retorna o golden set (casos aprovados)' })
  getGoldenSet(@Query('taskType') taskType?: string) {
    return this.benchmark.getGoldenSet(taskType)
  }

  @Patch('cases/:id/approve')
  @ApiOperation({ summary: 'Aprova um caso para o golden set' })
  approveCase(@Param('id') id: string) {
    return this.benchmark.approveCase(id)
  }

  @Get('strategy/:strategyId')
  @ApiOperation({ summary: 'Histórico de resultados de uma estratégia' })
  getStrategyHistory(@Param('strategyId') strategyId: string) {
    return this.benchmark.getStrategyHistory(strategyId)
  }
}
