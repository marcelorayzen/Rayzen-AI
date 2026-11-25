import { Module } from '@nestjs/common'
import { QaController } from './qa.controller'
import { QaService } from './qa.service'
import { MemoryModule } from '../memory/memory.module'
import { WikiModule } from '../wiki/wiki.module'

@Module({
  imports: [MemoryModule, WikiModule],
  controllers: [QaController],
  providers: [QaService],
  exports: [QaService],
})
export class QaModule {}
