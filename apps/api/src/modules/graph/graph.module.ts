import { Module } from '@nestjs/common'
import { GraphController } from './graph.controller'
import { GraphService } from './graph.service'
import { KnowledgeGraphService } from './knowledge-graph.service'
import { UniverseService } from './universe.service'
import { ProjectStateModule } from '../project-state/project-state.module'
import { HealthModule } from '../health/health.module'
import { EventModule } from '../event/event.module'

@Module({
  imports: [ProjectStateModule, HealthModule, EventModule],
  controllers: [GraphController],
  providers: [GraphService, KnowledgeGraphService, UniverseService],
  exports: [GraphService, KnowledgeGraphService, UniverseService],
})
export class GraphModule {}
