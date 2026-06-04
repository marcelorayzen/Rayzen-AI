import { Module } from '@nestjs/common'
import { ConversationService } from './conversation.service'
import { ConversationController } from './conversation.controller'
import { RouterModule } from '../router/router.module'
import { MemoryModule } from '../memory/memory.module'

@Module({
  imports: [RouterModule, MemoryModule],
  controllers: [ConversationController],
  providers: [ConversationService],
  exports: [ConversationService],
})
export class ConversationModule {}
