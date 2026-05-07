import { Module, forwardRef } from '@nestjs/common'
import { MemoryController } from './memory.controller'
import { MemoryService } from './memory.service'
import { EventModule } from '../event/event.module'

@Module({
  imports: [forwardRef(() => EventModule)],
  controllers: [MemoryController],
  providers: [MemoryService],
  exports: [MemoryService],
})
export class MemoryModule {}
