import { Module } from '@nestjs/common'
import { WikiController } from './wiki.controller'
import { WikiService } from './wiki.service'
import { WikiCompilationService } from './wiki-compilation.service'
import { WikiMergeService } from './wiki-merge.service'
import { WikiVersioningService } from './wiki-versioning.service'
import { BrainModule } from '../brain/brain.module'
import { EventModule } from '../event/event.module'

@Module({
  imports: [BrainModule, EventModule],
  controllers: [WikiController],
  providers: [
    WikiService,
    WikiCompilationService,
    WikiMergeService,
    WikiVersioningService,
  ],
  exports: [WikiService],
})
export class WikiModule {}
