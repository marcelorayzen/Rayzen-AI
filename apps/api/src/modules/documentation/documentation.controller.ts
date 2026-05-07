import { Controller, Post, Get, Patch, Param, Query } from '@nestjs/common'
import { ApiTags, ApiOperation } from '@nestjs/swagger'
import { DocumentationService, DocType } from './documentation.service'

@ApiTags('documentation')
@Controller('documentation')
export class DocumentationController {
  constructor(private readonly svc: DocumentationService) {}

  @Post('generate/:projectId')
  @ApiOperation({ summary: 'Gera ou atualiza todos os 4 documentos do projeto' })
  generateAll(@Param('projectId') projectId: string, @Query('force') force?: string) {
    return this.svc.generateAll(projectId, { force: force === 'true' })
  }

  @Post('generate/:projectId/:type')
  @ApiOperation({ summary: 'Gera um tipo específico: project_state | decisions_log | next_actions | work_journal' })
  generateOne(
    @Param('projectId') projectId: string,
    @Param('type') type: DocType,
    @Query('force') force?: string,
  ) {
    return this.svc.generate(projectId, type, { force: force === 'true' })
  }

  @Get(':projectId')
  @ApiOperation({ summary: 'Lista documentos gerados do projeto' })
  list(@Param('projectId') projectId: string) {
    return this.svc.list(projectId)
  }

  @Get(':projectId/:type/versions')
  @ApiOperation({ summary: 'Histórico de versões de um documento — inclui diff e sourceIds' })
  versions(@Param('projectId') projectId: string, @Param('type') type: DocType) {
    return this.svc.getVersions(projectId, type)
  }

  @Patch(':projectId/:type/reviewed')
  @ApiOperation({ summary: 'Marca documento como revisado manualmente — protege de sobrescrita' })
  markReviewed(@Param('projectId') projectId: string, @Param('type') type: DocType) {
    return this.svc.markReviewed(projectId, type as DocType)
  }

  @Post('generate/:projectId/data_map')
  @ApiOperation({ summary: 'Gera mapeamento de dados pessoais (PII) a partir do catálogo de dados' })
  generateDataMap(@Param('projectId') projectId: string) {
    return this.svc.generateDataMap(projectId)
  }

  @Post('generate/:projectId/ropa')
  @ApiOperation({ summary: 'Gera ROPA — Registro de Atividades de Tratamento (LGPD Art. 37 / GDPR Art. 30)' })
  generateROPA(@Param('projectId') projectId: string) {
    return this.svc.generateROPA(projectId)
  }

  @Post('generate/:projectId/quality_report')
  @ApiOperation({ summary: 'Gera relatório consolidado de qualidade de dados com scores e regras falhando' })
  generateQualityReport(@Param('projectId') projectId: string) {
    return this.svc.generateQualityReport(projectId)
  }
}
