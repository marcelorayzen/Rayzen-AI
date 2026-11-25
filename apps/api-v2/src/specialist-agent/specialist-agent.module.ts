import { Module } from '@nestjs/common'
import { SpecialistAgentService } from './specialist-agent.service'
import { SpecialistAgentController } from './specialist-agent.controller'

@Module({
  controllers: [SpecialistAgentController],
  providers:   [SpecialistAgentService],
  exports:     [SpecialistAgentService],
})
export class SpecialistAgentModule {}
