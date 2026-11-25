import { Module } from '@nestjs/common'
import { QaEngineService } from './qa-engine.service'
import { QaEngineController } from './qa-engine.controller'
import { MissionModule } from '../mission/mission.module'

@Module({
  imports: [MissionModule],
  controllers: [QaEngineController],
  providers: [QaEngineService],
  exports: [QaEngineService],
})
export class QaEngineModule {}
