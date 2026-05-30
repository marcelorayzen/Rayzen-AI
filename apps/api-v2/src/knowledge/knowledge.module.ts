import { Global, Module } from '@nestjs/common'
import { KnowledgeStorageService } from './knowledge-storage.service'
import { KnowledgeQueryService } from './knowledge-query.service'
import { KnowledgeExtractorService } from './knowledge-extractor.service'
import { KnowledgeImpactService } from './knowledge-impact.service'
import { KnowledgeGraphBuilderService } from './knowledge-graph-builder.service'
import { KnowledgeController } from './knowledge.controller'

@Global()
@Module({
  controllers: [KnowledgeController],
  providers: [
    KnowledgeStorageService,
    KnowledgeQueryService,
    KnowledgeExtractorService,
    KnowledgeImpactService,
    KnowledgeGraphBuilderService,
  ],
  exports: [KnowledgeStorageService, KnowledgeQueryService, KnowledgeImpactService, KnowledgeGraphBuilderService],
})
export class KnowledgeModule {}
