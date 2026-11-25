import { Module } from '@nestjs/common'
import { WorkflowEngineService } from './workflow-engine.service'
import { WorkflowController } from './workflow.controller'
import { MissionModule } from '../mission/mission.module'
import { SkillEngineModule } from '../skill-engine/skill-engine.module'
import { SpecialistModule } from '../specialists/specialist.module'
import { SpecialistAgentModule } from '../specialist-agent/specialist-agent.module'
import { DocumentationEngineModule } from '../documentation-engine/documentation-engine.module'
import { AgentDialogueModule } from '../agent-dialogue/agent-dialogue.module'

@Module({
  imports: [MissionModule, SkillEngineModule, SpecialistModule, SpecialistAgentModule, DocumentationEngineModule, AgentDialogueModule],
  controllers: [WorkflowController],
  providers: [WorkflowEngineService],
  exports: [WorkflowEngineService],
})
export class WorkflowModule {}
