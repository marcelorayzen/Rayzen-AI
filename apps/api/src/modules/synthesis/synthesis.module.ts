import { Module, forwardRef } from '@nestjs/common'
import { SynthesisController } from './synthesis.controller'
import { SynthesisService } from './synthesis.service'
import { SmartCheckpointService } from './smart-checkpoint.service'
import { DocumentationModule } from '../documentation/documentation.module'
import { ProjectStateModule } from '../project-state/project-state.module'
import { GraphModule } from '../graph/graph.module'
import { EventModule } from '../event/event.module'

@Module({
  // EventModule já importa forwardRef(SynthesisModule) (Stop hook chama checkpoint()) —
  // esse lado também precisa de forwardRef pra fechar o ciclo sem crash no boot.
  imports: [forwardRef(() => DocumentationModule), forwardRef(() => ProjectStateModule), GraphModule, forwardRef(() => EventModule)],
  controllers: [SynthesisController],
  providers: [SynthesisService, SmartCheckpointService],
  exports: [SynthesisService, SmartCheckpointService],
})
export class SynthesisModule {}
