import { Module } from '@nestjs/common'
import { BrainController } from './brain.controller'
import { BrainService } from './brain.service'
import { EventModule } from '../event/event.module'

@Module({
  imports: [EventModule],
  controllers: [BrainController],
  providers: [BrainService],
  exports: [BrainService],
})
export class BrainModule {}
