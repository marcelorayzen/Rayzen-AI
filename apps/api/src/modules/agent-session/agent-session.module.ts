import { Module } from '@nestjs/common'
import { AgentSessionService } from './agent-session.service'
import { AgentSessionController } from './agent-session.controller'
import { TelegramModule } from '../telegram/telegram.module'

@Module({
  imports: [TelegramModule],
  controllers: [AgentSessionController],
  providers: [AgentSessionService],
  exports: [AgentSessionService],
})
export class AgentSessionModule {}
