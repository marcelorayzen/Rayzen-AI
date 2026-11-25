import { Module } from '@nestjs/common'
import { ClarificationService } from './clarification.service'
import { LlmModule } from '../llm/llm.module'

@Module({
  imports: [LlmModule],
  providers: [ClarificationService],
  exports: [ClarificationService],
})
export class AgentDialogueModule {}
