import { Controller, Post, Get, Patch, Param, Query } from '@nestjs/common'
import { ApiTags, ApiOperation } from '@nestjs/swagger'
import { DocumentationService, DocType } from './documentation.service'

@ApiTags('documentation')
@Controller('documentation')
export class DocumentationController {
  constructor(private readonly svc: DocumentationService) {}

  /**
   * `?force=true` na rota significa **"uma pessoa pediu"**, e por isso mapeia para os
   * DOIS bypasses: ignora a proteção de documento revisado à mão *e* o piso de
   * frescor. Quem clica "regenerar" espera conteúdo novo, não o de 40 minutos atrás.
   *
   * O caminho automático não passa por aqui e recebe só `force` — ele precisa
   * sobrescrever documento revisado, mas **não** deve furar o piso. Era essa
   * distinção que não existia: um flag só, respondendo duas perguntas.
   */
  @Post('generate/:projectId')
  @ApiOperation({ summary: 'Gera ou atualiza os documentos vivos do projeto' })
  generateAll(@Param('projectId') projectId: string, @Query('force') force?: string) {
    const pedidoHumano = force === 'true'
    return this.svc.generateAll(projectId, { force: pedidoHumano, ignorarFrescor: pedidoHumano })
  }

  @Post('generate/:projectId/:type')
  @ApiOperation({ summary: 'Gera um tipo específico: project_state | decisions_log | next_actions | work_journal | test_evidence' })
  generateOne(
    @Param('projectId') projectId: string,
    @Param('type') type: DocType,
    @Query('force') force?: string,
  ) {
    const pedidoHumano = force === 'true'
    return this.svc.generate(projectId, type, { force: pedidoHumano, ignorarFrescor: pedidoHumano })
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
}
