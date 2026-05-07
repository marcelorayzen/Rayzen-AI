import { Controller, Get, Post, Delete, Body, Param, Query } from '@nestjs/common'
import { ApiTags, ApiOperation } from '@nestjs/swagger'
import { DataQualityService, CreateRuleDto, RunResultDto, ModelInfo } from './data-quality.service'

@ApiTags('data-quality')
@Controller('data-quality')
export class DataQualityController {
  constructor(private readonly dq: DataQualityService) {}

  @Post('rules')
  @ApiOperation({ summary: 'Criar regra de qualidade de dados' })
  createRule(@Body() dto: CreateRuleDto) {
    return this.dq.createRule(dto)
  }

  @Get('rules')
  @ApiOperation({ summary: 'Listar regras por projeto e/ou dataset' })
  getRules(
    @Query('project_id') projectId?: string,
    @Query('dataset') dataset?: string,
  ) {
    return this.dq.getRules(projectId, dataset)
  }

  @Delete('rules/:id')
  @ApiOperation({ summary: 'Desativar regra (soft delete)' })
  deleteRule(@Param('id') id: string) {
    return this.dq.deleteRule(id)
  }

  @Post('results')
  @ApiOperation({ summary: 'Registrar resultado de verificação de qualidade' })
  recordResult(@Body() dto: RunResultDto) {
    return this.dq.recordResult(dto)
  }

  @Get('results')
  @ApiOperation({ summary: 'Histórico de resultados de uma regra' })
  getResults(
    @Query('rule_id') ruleId: string,
    @Query('limit') limit?: string,
  ) {
    return this.dq.getResults(ruleId, limit ? parseInt(limit) : 20)
  }

  @Get('score')
  @ApiOperation({ summary: 'Score de qualidade por dataset (0–100, ponderado por severidade)' })
  getScore(
    @Query('project_id') projectId?: string,
    @Query('dataset') dataset?: string,
  ) {
    return this.dq.computeDatasetScore(projectId, dataset)
  }

  @Get('score/history')
  @ApiOperation({ summary: 'Histórico de score por dia' })
  getScoreHistory(
    @Query('project_id') projectId?: string,
    @Query('dataset') dataset?: string,
    @Query('days') days?: string,
  ) {
    return this.dq.getScoreHistory(projectId, dataset, days ? parseInt(days) : 30)
  }

  @Get('summary')
  @ApiOperation({ summary: 'Resumo geral de qualidade de dados do projeto' })
  getSummary(@Query('project_id') projectId?: string) {
    return this.dq.getSummary(projectId)
  }

  @Post('schema-diff')
  @ApiOperation({ summary: 'Recebe snapshot de schema, compara com anterior e retorna mudanças + regras impactadas' })
  schemaDiff(@Body() body: { models: ModelInfo[]; projectId?: string }) {
    return this.dq.diffSchema(body.models, body.projectId ?? undefined)
  }
}
