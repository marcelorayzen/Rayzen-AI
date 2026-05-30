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

@Module({
  imports: [
    CoreModule,
    LlmModule,
    AiRouterModule,
    MemoryModule,
    ContextEngineModule,
    MissionModule,
    RouterModule,
    SkillEngineModule,
    VaultModule,
    KnowledgeModule,
    ProjectMemoryModule,
  ],
})
export class AppModule {}
