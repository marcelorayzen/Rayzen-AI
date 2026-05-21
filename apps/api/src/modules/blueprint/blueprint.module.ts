import { Module } from '@nestjs/common'
import { BlueprintController, BlueprintProjectController } from './blueprint.controller'
import { BlueprintService } from './blueprint.service'
import { WikiModule } from '../wiki/wiki.module'
import { BrainModule } from '../brain/brain.module'
import { EventModule } from '../event/event.module'
import { ProjectStateModule } from '../project-state/project-state.module'

@Module({
  imports: [WikiModule, BrainModule, EventModule, ProjectStateModule],
  controllers: [BlueprintController, BlueprintProjectController],
  providers: [BlueprintService],
  exports: [BlueprintService],
})
export class BlueprintModule {}
