import { Global, Module } from '@nestjs/common'
import { ApprovalGatesService } from './approval-gates.service'
import { ApprovalGatesController } from './approval-gates.controller'
import { MissionModule } from '../mission/mission.module'
import { WorkflowModule } from '../workflow/workflow.module'
import { EventsModule } from '../gateway/events.module'

@Global()
@Module({
  // MissionModule + WorkflowModule para o gate→resume no controller.
  // EventsModule para emitir eventos WS quando gates são criados/aprovados/rejeitados.
  // Sem ciclo: nenhum deles importa ApprovalGatesModule (usam ApprovalGatesService via @Global).
  imports: [MissionModule, WorkflowModule, EventsModule],
  controllers: [ApprovalGatesController],
  providers: [ApprovalGatesService],
  exports: [ApprovalGatesService],
})
export class ApprovalGatesModule {}
