import { Module } from '@nestjs/common'
import { BullModule } from '@nestjs/bull'
import { ExecutionController } from './execution.controller'
import { ExecutionService } from './execution.service'
import { EventModule } from '../event/event.module'
import { AgentBridgeModule } from '../agent-bridge/agent-bridge.module'

@Module({
  imports: [BullModule.registerQueue({ name: 'agent-tasks' }), EventModule, AgentBridgeModule],
  controllers: [ExecutionController],
  providers: [ExecutionService],
  exports: [ExecutionService],
})
export class ExecutionModule {}
