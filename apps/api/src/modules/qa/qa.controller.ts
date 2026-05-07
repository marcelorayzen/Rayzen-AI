import { Controller, Get, Post, Body, Query } from '@nestjs/common'
import { ApiTags, ApiOperation } from '@nestjs/swagger'
import { QaService, SaveTestRunDto } from './qa.service'

@ApiTags('qa')
@Controller('qa')
export class QaController {

  constructor(private readonly qa: QaService) {}

  @Post('reports')
  @ApiOperation({ summary: 'Salvar resultado de um test run (do agente ou CI)' })
  saveRun(@Body() dto: SaveTestRunDto) {
    return this.qa.saveRun(dto)
  }

  @Get('reports')
  @ApiOperation({ summary: 'Listar runs por projeto' })
  getRuns(
    @Query('project_id') projectId?: string,
    @Query('limit') limit?: string,
  ) {
    return this.qa.getRuns(projectId, limit ? parseInt(limit) : 20)
  }

  @Get('patterns')
  @ApiOperation({ summary: 'Padrões de falha — testes que falharam com mais frequência' })
  getPatterns(
    @Query('project_id') projectId?: string,
    @Query('runs') runs?: string,
  ) {
    return this.qa.getFailurePatterns(projectId, runs ? parseInt(runs) : 10)
  }

  @Get('trend')
  @ApiOperation({ summary: 'Tendência de qualidade ao longo do tempo' })
  getTrend(
    @Query('project_id') projectId?: string,
    @Query('days') days?: string,
  ) {
    return this.qa.getQualityTrend(projectId, days ? parseInt(days) : 30)
  }
}
