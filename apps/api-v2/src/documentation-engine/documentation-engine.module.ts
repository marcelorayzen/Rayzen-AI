import { Module } from '@nestjs/common'
import { DocumentationEngineService } from './documentation-engine.service'
import { DocumentationEngineController } from './documentation-engine.controller'
import { MissionModule } from '../mission/mission.module'
import { MemoryModule } from '../memory/memory.module'

@Module({
  imports: [MissionModule, MemoryModule],
  controllers: [DocumentationEngineController],
  providers: [DocumentationEngineService],
  exports: [DocumentationEngineService],
})
export class DocumentationEngineModule {}
