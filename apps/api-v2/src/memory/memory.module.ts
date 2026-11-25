import { Module } from '@nestjs/common'
import { MemoryService } from './memory.service'
import { MemoryController } from './memory.controller'
import { KnowledgeGovernanceService } from './knowledge-governance.service'

@Module({
  controllers: [MemoryController],
  providers: [MemoryService, KnowledgeGovernanceService],
  exports: [MemoryService, KnowledgeGovernanceService],
})
export class MemoryModule {}
