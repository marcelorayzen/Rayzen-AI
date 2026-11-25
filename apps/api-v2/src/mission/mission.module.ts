import { Module } from '@nestjs/common'
import { MissionService } from './mission.service'
import { MissionController } from './mission.controller'
import { MissionResultService } from './mission-result.service'
import { StepExecutorService } from './step-executor.service'
import { MemoryModule } from '../memory/memory.module'
import { EventsModule } from '../gateway/events.module'
import { SpecialistAgentModule } from '../specialist-agent/specialist-agent.module'

@Module({
  imports: [MemoryModule, EventsModule, SpecialistAgentModule],
  controllers: [MissionController],
  providers: [MissionService, MissionResultService, StepExecutorService],
  exports: [MissionService, MissionResultService, StepExecutorService],
})
export class MissionModule {}
