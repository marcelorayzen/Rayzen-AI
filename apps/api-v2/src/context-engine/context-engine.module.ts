import { Global, Module } from '@nestjs/common'
import { ContextEngineService } from './context-engine.service'
import { ContextPackService } from './context-pack.service'
import { ContextEngineController } from './context-engine.controller'
import { MemoryModule } from '../memory/memory.module'

@Global()
@Module({
  imports: [MemoryModule],
  controllers: [ContextEngineController],
  providers: [ContextEngineService, ContextPackService],
  exports: [ContextEngineService, ContextPackService],
})
export class ContextEngineModule {}
