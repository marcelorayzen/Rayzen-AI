import {
  Controller, Get, Post, Patch, Delete,
  Param, Body, Query, UseGuards, HttpCode,
} from '@nestjs/common'
import { ApiTags, ApiBearerAuth, ApiQuery } from '@nestjs/swagger'
import { MissionService } from './mission.service'
import { MissionResultService } from './mission-result.service'
import { CreateMissionDto, CreateMissionStepDto, UpdateMissionStepDto } from './dto/create-mission.dto'
import { JwtAuthGuard } from '../core/auth.guard'

@ApiTags('missions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('missions')
export class MissionController {
  constructor(
    private readonly missions: MissionService,
    private readonly result:   MissionResultService,
  ) {}

  @Post()
  create(@Body() dto: CreateMissionDto) {
    return this.missions.create(dto)
  }

  @Get()
  @ApiQuery({ name: 'projectId', required: false })
  findAll(@Query('projectId') projectId?: string) {
    return this.missions.findAll(projectId)
  }

  @Get('next-pending')
  @ApiQuery({ name: 'projectId', required: true })
  nextPending(@Query('projectId') projectId: string) {
    return this.missions.findNextPending(projectId)
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.missions.findOne(id)
  }

  @Post(':id/execute')
  @HttpCode(200)
  execute(@Param('id') id: string) {
    return this.missions.transition(id, 'active')
  }

  @Post(':id/pause')
  @HttpCode(200)
  pause(@Param('id') id: string) {
    return this.missions.transition(id, 'paused')
  }

  @Post(':id/cancel')
  @HttpCode(200)
  cancel(@Param('id') id: string) {
    return this.missions.transition(id, 'cancelled')
  }

  @Post(':id/complete')
  @HttpCode(200)
  async complete(@Param('id') id: string) {
    const mission = await this.missions.transition(id, 'done')
    const result  = await this.result.processCompletion(id)
    return { mission, result }
  }

  /**
   * Retorna síntese + próximo passo sugerido para uma missão já concluída.
   * Também funciona para missões em andamento (parcial).
   */
  @Get(':id/result')
  getResult(@Param('id') id: string) {
    return this.result.processCompletion(id)
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id') id: string) {
    return this.missions.delete(id)
  }

  // ─── Steps ──────────────────────────────────────────────────────────────────

  @Get(':id/steps')
  listSteps(@Param('id') id: string) {
    return this.missions.listSteps(id)
  }

  @Post(':id/steps')
  addStep(@Param('id') id: string, @Body() dto: CreateMissionStepDto) {
    return this.missions.addStep(id, dto)
  }

  @Patch(':id/steps/:stepId')
  updateStep(
    @Param('id') id: string,
    @Param('stepId') stepId: string,
    @Body() dto: UpdateMissionStepDto,
  ) {
    return this.missions.updateStep(id, stepId, dto)
  }
}
