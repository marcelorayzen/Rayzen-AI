import { Module } from '@nestjs/common'
import { ContentEngineController } from './content-engine.controller'
import { ContentEngineService } from './content-engine.service'

@Module({
  controllers: [ContentEngineController],
  providers: [ContentEngineService],
  exports: [ContentEngineService],
})
export class ContentEngineModule {}
