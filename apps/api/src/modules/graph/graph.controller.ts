import { Controller, Get, Post, Put, Patch, Delete, Param, Body } from '@nestjs/common'
import { ApiTags, ApiOperation } from '@nestjs/swagger'
import { GraphService, CreateGoalDto, UpdateGoalDto, Kpi } from './graph.service'
import { KnowledgeGraphService } from './knowledge-graph.service'
import { UniverseService, UniverseNode, UniverseEdge } from './universe.service'

@ApiTags('graph')
@Controller('projects/:id/graph')
export class GraphController {
  constructor(
    private readonly graph: GraphService,
    private readonly knowledge: KnowledgeGraphService,
    private readonly universe: UniverseService,
  ) {}

  @Get('knowledge')
  @ApiOperation({ summary: 'Knowledge graph legado (somente leitura)' })
  getKnowledgeGraph(@Param('id') id: string) {
    return this.knowledge.build(id)
  }

  @Get('universe')
  @ApiOperation({ summary: 'Universe: canvas livre de conhecimento do projeto' })
  getUniverse(@Param('id') id: string) {
    return this.universe.get(id)
  }

  @Put('universe')
  @ApiOperation({ summary: 'Salvar estado completo do Universe (nodes + edges)' })
  saveUniverse(
    @Param('id') id: string,
    @Body() body: { nodes: UniverseNode[]; edges: UniverseEdge[] },
  ) {
    return this.universe.save(id, body.nodes ?? [], body.edges ?? [])
  }

  @Post('universe/import')
  @ApiOperation({ summary: 'Importar dados do projeto para o Universe como ponto de partida' })
  importUniverse(@Param('id') id: string) {
    return this.universe.importFromProject(id)
  }

  @Get()
  @ApiOperation({ summary: 'Mermaid do estado atual do projeto + state (milestones, blockers, next steps)' })
  getStateMermaid(@Param('id') id: string) {
    return this.graph.getStateGraph(id)
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

  @Get('events')
  @ApiOperation({ summary: 'Event Graph: eventos recentes mapeados por milestone via LLM' })
  getEventGraph(@Param('id') id: string) {
    return this.graph.getEventGraph(id)
  }

  @Post('goal/propose-progress')
  @ApiOperation({ summary: 'Propõe critérios de sucesso como concluídos com base nos eventos da sessão' })
  proposeGoalProgress(@Param('id') id: string) {
    return this.graph.proposeGoalProgress(id)
  }

  @Post('goal')
  @ApiOperation({ summary: 'Criar novo goal ativo (pausa o anterior)' })
  upsertGoal(@Param('id') id: string, @Body() dto: CreateGoalDto) {
    return this.graph.upsertGoal(id, dto)
  }

  @Patch('goal/:goalId')
  @ApiOperation({ summary: 'Editar goal existente' })
  updateGoal(
    @Param('id') id: string,
    @Param('goalId') goalId: string,
    @Body() dto: UpdateGoalDto,
  ) {
    return this.graph.updateGoal(id, goalId, dto)
  }

  @Delete('goal/:goalId')
  @ApiOperation({ summary: 'Excluir goal existente' })
  deleteGoal(@Param('id') id: string, @Param('goalId') goalId: string) {
    return this.graph.deleteGoal(id, goalId)
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

  @Patch('goal/:goalId/kpis')
  @ApiOperation({ summary: 'Substituir array completo de KPIs da meta' })
  replaceKpis(
    @Param('goalId') goalId: string,
    @Body() body: { kpis: Kpi[] },
  ) {
    return this.graph.replaceKpis(goalId, body.kpis ?? [])
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

  @Patch('goal/:goalId/rename')
  @ApiOperation({ summary: 'Renomear meta (título e descrição opcional)' })
  renameGoal(
    @Param('goalId') goalId: string,
    @Body() body: { title: string; description?: string },
  ) {
    return this.graph.renameGoal(goalId, body.title, body.description)
  }
}
