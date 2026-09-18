import { Module } from '@nestjs/common'
import { AgentSessionService } from './agent-session.service'
import { AgentSessionController } from './agent-session.controller'
import { TelegramModule } from '../telegram/telegram.module'
// A03: a sessão supervisionada passou a enfileirar de verdade, em vez de gravar numa tabela
// sem leitor. `ExecutionModule` já exporta `ExecutionService`.
import { ExecutionModule } from '../execution/execution.module'
import { PendingReplyModule } from './pending-reply.module'

@Module({
  imports: [TelegramModule, ExecutionModule, PendingReplyModule],
  controllers: [AgentSessionController],
  providers: [AgentSessionService],
  exports: [AgentSessionService],
})
export class AgentSessionModule {}
