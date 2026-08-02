import { Module } from '@nestjs/common'
import { APP_GUARD } from '@nestjs/core'
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler'
import { PingController } from './ping.controller'
import { CoreModule } from './core/core.module'
import { LlmModule } from './llm/llm.module'
import { MissionModule } from './mission/mission.module'
import { RouterModule } from './router/router.module'
import { ConversationModule } from './conversation/conversation.module'
import { DiscoveryModule } from './discovery/discovery.module'
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
import { PolicyEngineModule } from './policy-engine/policy-engine.module'
import { CatalogModule } from './catalog/catalog.module'
import { EventsModule } from './gateway/events.module'
import { BenchmarkModule } from './benchmark/benchmark.module'
import { AgentDialogueModule } from './agent-dialogue/agent-dialogue.module'
import { EvolutionaryModule } from './evolutionary/evolutionary.module'
import { QaScientistModule } from './qa-scientist/qa-scientist.module'

@Module({
  controllers: [PingController],
  imports: [
    // Mesmo limite da V1 — a V2 também fica exposta via Cloudflare Tunnel
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 120 }]),
    CoreModule,
    LlmModule,
    CostControllerModule,
    ObservabilityModule,
    AiRouterModule,
    MemoryModule,
    ContextEngineModule,
    MissionModule,
    RouterModule,
    ConversationModule,
    DiscoveryModule,
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
    PolicyEngineModule,
    CatalogModule,
    EventsModule,
    BenchmarkModule,
    AgentDialogueModule,
    EvolutionaryModule,
    QaScientistModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
