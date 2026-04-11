import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { PrismaModule } from './prisma/prisma.module'
import { BullModule } from '@nestjs/bull'
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler'
import { APP_GUARD } from '@nestjs/core'
import { AuthModule } from './modules/auth/auth.module'
import { ConfigurationModule } from './modules/configuration/configuration.module'
import { OrchestratorModule } from './modules/orchestrator/orchestrator.module'
import { AgentBridgeModule } from './modules/agent-bridge/agent-bridge.module'
import { MemoryModule } from './modules/memory/memory.module'
import { DocumentProcessingModule } from './modules/document-processing/document-processing.module'
import { ExecutionModule } from './modules/execution/execution.module'
import { ContentEngineModule } from './modules/content-engine/content-engine.module'
import { SessionModule } from './modules/session/session.module'
import { VoiceModule } from './modules/voice/voice.module'
import { ValidationModule } from './modules/validation/validation.module'
import { ProjectModule } from './modules/project/project.module'
import { EventModule } from './modules/event/event.module'
import { SynthesisModule } from './modules/synthesis/synthesis.module'
import { DocumentationModule } from './modules/documentation/documentation.module'
import { ObsidianModule } from './modules/obsidian/obsidian.module'
import { ProjectStateModule } from './modules/project-state/project-state.module'
import { GitModule } from './modules/git/git.module'
import { ProactiveModule } from './modules/proactive/proactive.module'
import { HealthModule } from './modules/health/health.module'
import { NotionModule } from './modules/notion/notion.module'
import { BrainModule } from './modules/brain/brain.module'
import { WikiModule } from './modules/wiki/wiki.module'

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    BullModule.forRoot({ redis: process.env.REDIS_URL }),
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 120 }]),
    AuthModule,
    ConfigurationModule,
    OrchestratorModule,
    AgentBridgeModule,
    MemoryModule,
    DocumentProcessingModule,
    ExecutionModule,
    ContentEngineModule,
    SessionModule,
    VoiceModule,
    ValidationModule,
    ProjectModule,
    EventModule,
    SynthesisModule,
    DocumentationModule,
    ObsidianModule,
    ProjectStateModule,
    GitModule,
    ProactiveModule,
    HealthModule,
    NotionModule,
    BrainModule,
    WikiModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
