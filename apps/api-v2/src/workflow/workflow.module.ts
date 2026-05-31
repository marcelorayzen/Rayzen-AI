import { Module } from '@nestjs/common'
import { WorkflowEngineService } from './workflow-engine.service'
import { WorkflowController } from './workflow.controller'
import { MissionModule } from '../mission/mission.module'
import { SkillEngineModule } from '../skill-engine/skill-engine.module'
import { SpecialistModule } from '../specialists/specialist.module'
import { DocumentationEngineModule } from '../documentation-engine/documentation-engine.module'

@Module({
  imports: [MissionModule, SkillEngineModule, SpecialistModule, DocumentationEngineModule],
  controllers: [WorkflowController],
  providers: [WorkflowEngineService],
  exports: [WorkflowEngineService],
})
export class WorkflowModule {}
