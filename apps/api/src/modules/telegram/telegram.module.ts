import { Module, forwardRef } from '@nestjs/common'
import { TelegramService } from './telegram.service'
import { OrchestratorModule } from '../orchestrator/orchestrator.module'
import { ProjectModule } from '../project/project.module'
import { ProjectStateModule } from '../project-state/project-state.module'
import { GraphModule } from '../graph/graph.module'
import { PrismaModule } from '../../prisma/prisma.module'

@Module({
  imports: [
    forwardRef(() => OrchestratorModule),
    ProjectModule,
    ProjectStateModule,
    GraphModule,
    PrismaModule,
  ],
  providers: [TelegramService],
  exports: [TelegramService],
})
export class TelegramModule {}
