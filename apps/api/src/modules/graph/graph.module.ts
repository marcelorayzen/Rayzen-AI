import { Module } from '@nestjs/common'
import { GraphController } from './graph.controller'
import { GraphService } from './graph.service'
import { ProjectStateModule } from '../project-state/project-state.module'
import { HealthModule } from '../health/health.module'

@Module({
  imports: [ProjectStateModule, HealthModule],
  controllers: [GraphController],
  providers: [GraphService],
  exports: [GraphService],
})
export class GraphModule {}
