import { Module, forwardRef } from '@nestjs/common'
import { SynthesisController } from './synthesis.controller'
import { SynthesisService } from './synthesis.service'
import { SmartCheckpointService } from './smart-checkpoint.service'
import { DocumentationModule } from '../documentation/documentation.module'
import { ProjectStateModule } from '../project-state/project-state.module'

@Module({
  imports: [forwardRef(() => DocumentationModule), forwardRef(() => ProjectStateModule)],
  controllers: [SynthesisController],
  providers: [SynthesisService, SmartCheckpointService],
  exports: [SynthesisService, SmartCheckpointService],
})
export class SynthesisModule {}
