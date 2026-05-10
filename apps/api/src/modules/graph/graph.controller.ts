import { Controller, Get, Post, Patch, Param, Body } from '@nestjs/common'
import { ApiTags, ApiOperation } from '@nestjs/swagger'
import { GraphService, CreateGoalDto } from './graph.service'

@ApiTags('graph')
@Controller('projects/:id/graph')
export class GraphController {
  constructor(private readonly graph: GraphService) {}

  @Get()
  @ApiOperation({ summary: 'Mermaid do estado atual do projeto (milestones, blockers, next steps)' })
  async getStateMermaid(@Param('id') id: string) {
    const mermaid = await this.graph.generateStateMermaid(id)
    return { mermaid }
  }

  @Get('goal')
  @ApiOperation({ summary: 'Goal Graph: meta ativa + gap analysis + Next Best Action' })
  getGoalGraph(@Param('id') id: string) {
    return this.graph.getGoalGraph(id)
  }

  @Get('goals')
  @ApiOperation({ summary: 'Listar todos os goals do projeto' })
  listGoals(@Param('id') id: string) {
    return this.graph.listGoals(id)
  }

  @Post('goal')
  @ApiOperation({ summary: 'Criar novo goal ativo (pausa o anterior)' })
  upsertGoal(@Param('id') id: string, @Body() dto: CreateGoalDto) {
    return this.graph.upsertGoal(id, dto)
  }

  @Patch('goal/:goalId/criteria')
  @ApiOperation({ summary: 'Substituir array completo de critérios da meta' })
  updateCriteria(
    @Param('goalId') goalId: string,
    @Body() body: { criteria: Array<{ id: string; text: string; done: boolean }> },
  ) {
    return this.graph.updateCriteria(goalId, body.criteria)
  }

  @Patch('goal/:goalId/criteria/:criteriaId')
  @ApiOperation({ summary: 'Marcar critério de sucesso como done ou undone' })
  toggleCriteria(
    @Param('goalId') goalId: string,
    @Param('criteriaId') criteriaId: string,
    @Body() body: { done: boolean },
  ) {
    return this.graph.toggleCriteria(goalId, criteriaId, body.done)
  }

  @Patch('goal/:goalId/kpi')
  @ApiOperation({ summary: 'Atualizar valor atual de um KPI da meta' })
  updateKpi(
    @Param('goalId') goalId: string,
    @Body() body: { metric: string; current: string },
  ) {
    return this.graph.updateKpi(goalId, body.metric, body.current)
  }

  @Post('goal/:goalId/kpi/auto-track')
  @ApiOperation({ summary: 'Auto-detect valores atuais dos KPIs via LLM analisando eventos recentes' })
  autoTrackKpis(@Param('id') id: string, @Param('goalId') goalId: string) {
    return this.graph.autoTrackKpis(id, goalId)
  }

  @Patch('goal/:goalId/status')
  @ApiOperation({ summary: 'Alterar status da meta (achieved | paused | cancelled | active)' })
  setGoalStatus(
    @Param('goalId') goalId: string,
    @Body() body: { status: 'active' | 'achieved' | 'paused' | 'cancelled' },
  ) {
    return this.graph.setGoalStatus(goalId, body.status)
  }
}
