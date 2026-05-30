import { Module } from '@nestjs/common'
import { CoreModule } from './core/core.module'
import { LlmModule } from './llm/llm.module'
import { MissionModule } from './mission/mission.module'
import { RouterModule } from './router/router.module'
import { MemoryModule } from './memory/memory.module'
import { AiRouterModule } from './ai-router/ai-router.module'
import { ContextEngineModule } from './context-engine/context-engine.module'
import { SkillEngineModule } from './skill-engine/skill-engine.module'
import { VaultModule } from './vault/vault.module'
import { KnowledgeModule } from './knowledge/knowledge.module'
import { ProjectMemoryModule } from './project-memory/project-memory.module'
import { ApprovalGatesModule } from './approval-gates/approval-gates.module'
import { WorkflowModule } from './workflow/workflow.module'
import { QaEngineModule } from './qa-engine/qa-engine.module'
import { DocumentationEngineModule } from './documentation-engine/documentation-engine.module'
import { CostControllerModule } from './cost-controller/cost-controller.module'
import { ObservabilityModule } from './observability/observability.module'
import { ResourceManagerModule } from './resource-manager/resource-manager.module'
import { MissionSchedulerModule } from './mission-scheduler/mission-scheduler.module'
import { SpecialistModule } from './specialists/specialist.module'

@Module({
  imports: [
    CoreModule,
    LlmModule,
    CostControllerModule,
    ObservabilityModule,
    AiRouterModule,
    MemoryModule,
    ContextEngineModule,
    MissionModule,
    RouterModule,
    SkillEngineModule,
    VaultModule,
    KnowledgeModule,
    ProjectMemoryModule,
    ApprovalGatesModule,
    WorkflowModule,
    QaEngineModule,
    DocumentationEngineModule,
    ResourceManagerModule,
    MissionSchedulerModule,
    SpecialistModule,
  ],
})
export class AppModule {}
