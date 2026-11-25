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
// `SessionModule` não importa ninguém (só o Prisma global), então esta aresta não pode fechar
// grafo — é a mesma razão pela qual o Telegram pôde depender dele direto, sem `forwardRef`. O
// ciclo de 14/09 derrubou a produção com `tsc` limpo e 578 asserções verdes; `aplicacao-sobe.spec`
// é quem confere isto de verdade.
import { SessionModule } from '../session/session.module'

@Module({
  imports: [MemoryModule, DocumentProcessingModule, ExecutionModule, ContentEngineModule, ConfigurationModule, ValidationModule, EventModule, MetricsModule, AgentSessionModule, SessionModule],
  controllers: [OrchestratorController],
  providers: [OrchestratorService],
  exports: [OrchestratorService],
})
export class OrchestratorModule {}
