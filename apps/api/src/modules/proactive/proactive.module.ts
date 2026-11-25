import { Module } from '@nestjs/common'
import { ProactiveController } from './proactive.controller'
import { ProactiveService } from './proactive.service'

@Module({
  controllers: [ProactiveController],
  providers: [ProactiveService],
  exports: [ProactiveService],
})
export class ProactiveModule {}
