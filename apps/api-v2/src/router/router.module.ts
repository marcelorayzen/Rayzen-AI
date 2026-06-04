import { Module } from '@nestjs/common'
import { RouterService } from './router.service'
import { RouterController } from './router.controller'
import { MissionModule } from '../mission/mission.module'
import { SpecialistAgentModule } from '../specialist-agent/specialist-agent.module'

@Module({
  imports: [MissionModule, SpecialistAgentModule],
  controllers: [RouterController],
  providers: [RouterService],
  exports: [RouterService],
})
export class RouterModule {}
