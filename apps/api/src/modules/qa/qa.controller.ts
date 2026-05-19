import { Controller, Get, Post, Body, Query, Param, UseGuards, UnauthorizedException } from '@nestjs/common'
import { ApiTags, ApiOperation } from '@nestjs/swagger'
import { QaService, SaveTestRunDto } from './qa.service'
import { AgentTokenGuard } from '../agent-bridge/agent-token.guard'

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


  @Get('reports/:runId')
  @ApiOperation({ summary: 'Detalhe de um test run com falhas e evid?ncias vinculadas' })
  getRunDetail(@Param('runId') runId: string) {
    return this.qa.getRunDetail(runId)
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

  @Get('flaky')
  @ApiOperation({ summary: 'Testes flaky — falham em parte dos runs, não em todos' })
  getFlaky(
    @Query('project_id') projectId?: string,
    @Query('runs') runs?: string,
  ) {
    return this.qa.getFlakyTests(projectId, runs ? parseInt(runs) : 20)
  }

  @Get('summary')
  @ApiOperation({ summary: 'Resumo de qualidade — último run, top falhas, flaky tests' })
  getSummary(@Query('project_id') projectId?: string) {
    return this.qa.getSummary(projectId)
  }

  @Post('reports/ingest')
  @UseGuards(AgentTokenGuard)
  @ApiOperation({ summary: 'Ingest de relatório via CI/CD (GitHub Actions, GitLab, Jenkins)' })
  async ingest(
    @Body() body: {
      projectName?: string
      projectId?: string
      tool?: string
      branch?: string
      commitHash?: string
      format?: 'junit' | 'allure' | 'auto'
      reportBase64?: string
      reportContent?: string
    },
  ) {
    if (!body.reportBase64 && !body.reportContent) {
      throw new UnauthorizedException('Forneça reportBase64 ou reportContent')
    }

    const content = body.reportBase64
      ? Buffer.from(body.reportBase64, 'base64').toString('utf-8')
      : body.reportContent!

    return this.qa.ingestFromCi({
      content,
      format: body.format ?? 'auto',
      tool: body.tool,
      projectName: body.projectName,
      projectId: body.projectId,
      branch: body.branch,
      commitHash: body.commitHash,
    })
  }
}
