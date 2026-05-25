import { Module } from '@nestjs/common'
import { OrchestratorController } from './orchestrator.controller'
import { OrchestratorService } from './orchestrator.service'
import { MemoryModule } from '../memory/memory.module'
import { DocumentProcessingModule } from '../document-processing/document-processing.module'
import { ExecutionModule } from '../execution/execution.module'
import { ContentEngineModule } from '../content-engine/content-engine.module'
import { ConfigurationModule } from '../configuration/configuration.module'
import { ValidationModule } from '../validation/validation.module'
import { EventModule } from '../event/event.module'
import { MetricsModule } from '../metrics/metrics.module'
import { AgentSessionModule } from '../agent-session/agent-session.module'

@Module({
  imports: [MemoryModule, DocumentProcessingModule, ExecutionModule, ContentEngineModule, ConfigurationModule, ValidationModule, EventModule, MetricsModule, AgentSessionModule],
  controllers: [OrchestratorController],
  providers: [OrchestratorService],
  exports: [OrchestratorService],
})
export class OrchestratorModule {}
