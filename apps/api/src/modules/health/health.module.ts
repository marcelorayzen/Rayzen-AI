import { Module } from '@nestjs/common'
import { HealthController } from './health.controller'
import { HealthScoreService } from './health.service'
import { InfraHealthController } from './infra-health.controller'
import { InfraHealthService } from './infra-health.service'
import { AgentBridgeModule } from '../agent-bridge/agent-bridge.module'

@Module({
  imports: [AgentBridgeModule],
  controllers: [HealthController, InfraHealthController],
  providers: [HealthScoreService, InfraHealthService],
  exports: [HealthScoreService, InfraHealthService],
})
export class HealthModule {}
