import { Module } from '@nestjs/common'
import { GraphController } from './graph.controller'
import { GraphService } from './graph.service'
import { KnowledgeGraphService } from './knowledge-graph.service'
import { ProjectStateModule } from '../project-state/project-state.module'
import { HealthModule } from '../health/health.module'

@Module({
  imports: [ProjectStateModule, HealthModule],
  controllers: [GraphController],
  providers: [GraphService, KnowledgeGraphService],
  exports: [GraphService, KnowledgeGraphService],
})
export class GraphModule {}
