import { Module } from '@nestjs/common'
import { CoreModule } from './core/core.module'
import { MissionModule } from './mission/mission.module'

@Module({
  imports: [CoreModule, MissionModule],
})
export class AppModule {}
