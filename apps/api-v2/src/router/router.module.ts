import { Module } from '@nestjs/common'
import { RouterService } from './router.service'
import { RouterController } from './router.controller'
import { MissionModule } from '../mission/mission.module'

@Module({
  imports: [MissionModule],
  controllers: [RouterController],
  providers: [RouterService],
  exports: [RouterService],
})
export class RouterModule {}
