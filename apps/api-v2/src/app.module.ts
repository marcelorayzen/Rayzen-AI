import { Module } from '@nestjs/common'
import { CoreModule } from './core/core.module'
import { LlmModule } from './llm/llm.module'
import { MissionModule } from './mission/mission.module'
import { RouterModule } from './router/router.module'
import { MemoryModule } from './memory/memory.module'

@Module({
  imports: [CoreModule, LlmModule, MissionModule, RouterModule, MemoryModule],
})
export class AppModule {}
