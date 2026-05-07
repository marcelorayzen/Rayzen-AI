import { Module } from '@nestjs/common'
import { QaController } from './qa.controller'
import { QaService } from './qa.service'
import { MemoryModule } from '../memory/memory.module'

@Module({
  imports: [MemoryModule],
  controllers: [QaController],
  providers: [QaService],
  exports: [QaService],
})
export class QaModule {}
