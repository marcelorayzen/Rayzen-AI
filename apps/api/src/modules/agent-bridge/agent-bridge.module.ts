import { Module } from '@nestjs/common'
import { BullModule } from '@nestjs/bull'
import { AgentBridgeController } from './agent-bridge.controller'
import { AgentBridgeService } from './agent-bridge.service'
import { AgentTokenGuard } from './agent-token.guard'
import { AuditLogService } from './audit-log.service'

@Module({
  imports: [BullModule.registerQueue({ name: 'agent-tasks' })],
  controllers: [AgentBridgeController],
  providers: [AgentBridgeService, AgentTokenGuard, AuditLogService],
  exports: [AgentBridgeService, AuditLogService],
})
export class AgentBridgeModule {}
