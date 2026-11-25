import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common'
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger'
import { IsString, IsOptional } from 'class-validator'
import { JwtAuthGuard } from '../core/auth.guard'
import { QaScientistService } from './qa-scientist.service'

class RunCycleDto {
  @IsString()
  projectId!: string

  @IsOptional() @IsString()
  taskType?: string
}

@ApiTags('qa-scientist')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('qa-scientist')
export class QaScientistController {
  constructor(private readonly scientist: QaScientistService) {}

  @Post('run')
  @ApiOperation({ summary: 'Dispara o ciclo do QA Scientist manualmente para um projeto' })
  run(@Body() dto: RunCycleDto) {
    return this.scientist.dailyCycle(dto.projectId)
  }

  @Post('run-all')
  @ApiOperation({ summary: 'Dispara o ciclo para todos os projetos no catálogo' })
  runAll() {
    return this.scientist.runForAllProjects()
  }

  @Get('hypotheses')
  @ApiOperation({ summary: 'Lista hipóteses (filtros: projectId, status, limit)' })
  list(
    @Query('projectId') projectId?: string,
    @Query('status')    status?: string,
    @Query('limit')     limit?: string,
  ) {
    return this.scientist.listHypotheses({
      projectId,
      status,
      limit: limit ? parseInt(limit) : undefined,
    })
  }

  @Get('hypotheses/:id')
  @ApiOperation({ summary: 'Detalhe de uma hipótese (inclui report markdown)' })
  get(@Param('id') id: string) {
    return this.scientist.getHypothesis(id)
  }

  @Patch('hypotheses/:id/reject')
  @ApiOperation({ summary: 'Rejeita uma hipótese manualmente' })
  reject(@Param('id') id: string) {
    return this.scientist.rejectHypothesis(id)
  }
}
