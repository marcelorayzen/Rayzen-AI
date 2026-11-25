import { Global, Module } from '@nestjs/common'
import { KnowledgeStorageService } from './knowledge-storage.service'
import { KnowledgeQueryService } from './knowledge-query.service'
import { KnowledgeExtractorService } from './knowledge-extractor.service'
import { KnowledgeImpactService } from './knowledge-impact.service'
import { KnowledgeGraphBuilderService } from './knowledge-graph-builder.service'
import { KnowledgeGovernanceService } from './knowledge-governance.service'
import { KnowledgeController } from './knowledge.controller'
import { LineageService } from './lineage.service'
import { LineageController } from './lineage.controller'
import { CodeLineageService } from './code-lineage.service'

@Global()
@Module({
  controllers: [KnowledgeController, LineageController],
  providers: [
    KnowledgeGovernanceService,
    KnowledgeStorageService,
    KnowledgeQueryService,
    KnowledgeExtractorService,
    KnowledgeImpactService,
    KnowledgeGraphBuilderService,
    LineageService,
    CodeLineageService,
  ],
  exports: [
    KnowledgeStorageService, KnowledgeQueryService, KnowledgeImpactService,
    KnowledgeGraphBuilderService, KnowledgeGovernanceService, LineageService,
    CodeLineageService,
  ],
})
export class KnowledgeModule {}
