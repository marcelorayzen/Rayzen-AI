import { Module } from '@nestjs/common'
import { MissionSchedulerService } from './mission-scheduler.service'
import { MissionSchedulerController } from './mission-scheduler.controller'
import { MissionModule } from '../mission/mission.module'

@Module({
  imports: [MissionModule],
  controllers: [MissionSchedulerController],
  providers: [MissionSchedulerService],
  exports: [MissionSchedulerService],
})
export class MissionSchedulerModule {}
