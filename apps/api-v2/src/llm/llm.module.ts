import { Global, Module } from '@nestjs/common'
import { LlmService } from './llm.service'
import { CostControllerModule } from '../cost-controller/cost-controller.module'

@Global()
@Module({
  // Explícito mesmo o CostControllerModule sendo @Global: a dependência fica
  // legível aqui e não depende da ordem de registro no app.module.
  imports: [CostControllerModule],
  providers: [LlmService],
  exports: [LlmService],
})
export class LlmModule {}
