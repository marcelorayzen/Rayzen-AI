import { Global, Module } from '@nestjs/common'
import { ContextEngineService } from './context-engine.service'
import { ContextEngineController } from './context-engine.controller'
import { MemoryModule } from '../memory/memory.module'

@Global()
@Module({
  imports: [MemoryModule],
  controllers: [ContextEngineController],
  providers: [ContextEngineService],
  exports: [ContextEngineService],
})
export class ContextEngineModule {}
