import { Controller, Get, Post, Patch, Param, Body } from '@nestjs/common'
import { ApiTags, ApiOperation } from '@nestjs/swagger'
import { ProjectStateService, Milestone, BacklogItem, PlanningNode, GraphLink } from './project-state.service'

@ApiTags('project-state')
@Controller('projects')
export class ProjectStateController {
  constructor(private readonly svc: ProjectStateService) {}

  @Get(':id/state')
  @ApiOperation({ summary: 'Obter estado estruturado atual do projeto' })
  get(@Param('id') id: string) {
    return this.svc.get(id)
  }

  @Post(':id/state/refresh')
  @ApiOperation({ summary: 'Regenerar estado do projeto com base nos eventos e sínteses recentes' })
  refresh(@Param('id') id: string) {
    return this.svc.refresh(id)
  }

  @Post(':id/resume')
  @ApiOperation({ summary: 'Brief de retomada: onde parei, o que mudou, blockers ativos, próximo melhor passo' })
  resume(@Param('id') id: string) {
    return this.svc.resume(id)
  }

  @Patch(':id/state/planning')
  @ApiOperation({ summary: 'Atualizar campos de planejamento: milestones, backlog, activeFocus, definitionOfDone' })
  updatePlanning(
    @Param('id') id: string,
    @Body() body: {
      milestones?: Milestone[]
      backlog?: BacklogItem[]
      activeFocus?: string
      definitionOfDone?: string
      blockers?: Array<string | PlanningNode>
      nextSteps?: Array<string | PlanningNode>
      graphLinks?: GraphLink[]
    },
  ) {
    return this.svc.updatePlanning(id, body)
  }
}
