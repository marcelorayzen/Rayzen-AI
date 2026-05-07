import { Module } from '@nestjs/common'
import { BullModule } from '@nestjs/bull'
import { AgentBridgeController } from './agent-bridge.controller'
import { AgentBridgeService } from './agent-bridge.service'
import { AgentTokenGuard } from './agent-token.guard'

@Module({
  imports: [BullModule.registerQueue({ name: 'agent-tasks' })],
  controllers: [AgentBridgeController],
  providers: [AgentBridgeService, AgentTokenGuard],
  exports: [AgentBridgeService],
})
export class AgentBridgeModule {}
