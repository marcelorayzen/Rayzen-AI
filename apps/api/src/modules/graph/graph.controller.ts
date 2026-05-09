import { Controller, Get, Post, Patch, Param, Body, Query } from '@nestjs/common'
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

  @Patch('goal/:goalId/criteria/:criteriaId')
  @ApiOperation({ summary: 'Marcar critério de sucesso como done ou undone' })
  toggleCriteria(
    @Param('goalId') goalId: string,
    @Param('criteriaId') criteriaId: string,
    @Body() body: { done: boolean },
  ) {
    return this.graph.toggleCriteria(goalId, criteriaId, body.done)
  }
}
