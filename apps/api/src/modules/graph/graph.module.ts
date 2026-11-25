import { Module, forwardRef } from '@nestjs/common'
import { GraphController } from './graph.controller'
import { GraphService } from './graph.service'
import { KnowledgeGraphService } from './knowledge-graph.service'
import { UniverseService } from './universe.service'
import { ProjectStateModule } from '../project-state/project-state.module'
import { HealthModule } from '../health/health.module'
import { EventModule } from '../event/event.module'

@Module({
  // EventModule -> forwardRef(SynthesisModule) -> GraphModule (direto, sem forwardRef)
  // fecha um ciclo real — GraphModule precisa do forwardRef no lado que falta.
  imports: [ProjectStateModule, HealthModule, forwardRef(() => EventModule)],
  controllers: [GraphController],
  providers: [GraphService, KnowledgeGraphService, UniverseService],
  exports: [GraphService, KnowledgeGraphService, UniverseService],
})
export class GraphModule {}
