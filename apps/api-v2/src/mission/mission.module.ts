import { Module } from '@nestjs/common'
import { MissionService } from './mission.service'
import { MissionController } from './mission.controller'
import { MissionResultService } from './mission-result.service'
import { MemoryModule } from '../memory/memory.module'

@Module({
  imports: [MemoryModule],
  controllers: [MissionController],
  providers: [MissionService, MissionResultService],
  exports: [MissionService, MissionResultService],
})
export class MissionModule {}
