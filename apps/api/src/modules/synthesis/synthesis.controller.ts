import { Controller, Post, Get, Body, Query, Param, HttpCode } from '@nestjs/common'
import { ApiTags, ApiOperation } from '@nestjs/swagger'
import { SynthesisService } from './synthesis.service'
import { SmartCheckpointService } from './smart-checkpoint.service'
import { UniverseService } from '../graph/universe.service'

@ApiTags('synthesis')
@Controller('synthesis')
export class SynthesisController {
  constructor(
    private readonly svc: SynthesisService,
    private readonly smartCheckpoint: SmartCheckpointService,
    private readonly universe: UniverseService,
  ) {}

  @Post('session')
  @ApiOperation({ summary: 'Sintetizar sessão: extrai decisions, next_steps, learnings via LLM' })
  synthesize(@Body() body: { sessionId: string; projectId?: string; workMode?: string }) {
    return this.svc.synthesizeSession(body.sessionId, body.projectId, body.workMode)
  }

  @Post('checkpoint')
  @HttpCode(202)
  @ApiOperation({ summary: 'Checkpoint manual: dispara síntese em background e retorna imediatamente' })
  checkpoint(@Body() body: { projectId: string; note?: string; workMode?: string }) {
    const checkpointId = `checkpoint-${Date.now()}`
    this.svc.checkpoint(body.projectId, body.note, body.workMode)
      .then(() => {
        this.universe.importFromProject(body.projectId).catch(() => {})
      })
      .catch(() => {})
    return { status: 'processing', checkpointId, message: 'Checkpoint iniciado — atualize em alguns segundos' }
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
