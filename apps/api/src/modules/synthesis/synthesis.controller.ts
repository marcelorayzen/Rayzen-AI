import { Controller, Post, Get, Body, Query, Param, Inject, forwardRef } from '@nestjs/common'
import { ApiTags, ApiOperation } from '@nestjs/swagger'
import { SynthesisService } from './synthesis.service'
import { SmartCheckpointService } from './smart-checkpoint.service'
import { DocumentationService } from '../documentation/documentation.service'
import { UniverseService } from '../graph/universe.service'

@ApiTags('synthesis')
@Controller('synthesis')
export class SynthesisController {
  constructor(
    private readonly svc: SynthesisService,
    private readonly smartCheckpoint: SmartCheckpointService,
    @Inject(forwardRef(() => DocumentationService))
    private readonly docSvc: DocumentationService,
    private readonly universe: UniverseService,
  ) {}

  @Post('session')
  @ApiOperation({ summary: 'Sintetizar sessão: extrai decisions, next_steps, learnings via LLM' })
  synthesize(@Body() body: { sessionId: string; projectId?: string; workMode?: string }) {
    return this.svc.synthesizeSession(body.sessionId, body.projectId, body.workMode)
  }

  @Post('checkpoint')
  @ApiOperation({ summary: 'Checkpoint manual: sintetiza atividade desde o último checkpoint ou últimas 2h' })
  async checkpoint(@Body() body: { projectId: string; note?: string; workMode?: string }) {
    const result = await this.svc.checkpoint(body.projectId, body.note, body.workMode)
    // Pipeline automático em background: state refresh + regeneração de todos os docs
    this.docSvc.generateAll(body.projectId, { force: true }).catch(() => {})
    // Auto-rebuild Universe se ainda estiver vazio (primeira vez ou projeto novo)
    this.universe.get(body.projectId).then(u => {
      if (u.nodes.length === 0) {
        this.universe.importFromProject(body.projectId).catch(() => {})
      }
    }).catch(() => {})
    return result
  }

  @Get('artifacts')
  @ApiOperation({ summary: 'Listar artefatos de síntese por projeto ou sessão' })
  list(@Query('project_id') projectId?: string, @Query('session_id') sessionId?: string) {
    return this.svc.getArtifacts(projectId, sessionId)
  }

  @Post('checkpoint/auto/:projectId')
  @ApiOperation({ summary: 'Verificar e disparar auto-checkpoint se condições forem atendidas' })
  autoCheckpoint(@Param('projectId') projectId: string) {
    return this.smartCheckpoint.checkProject(projectId)
  }
}
