import { Global, Module } from '@nestjs/common'
import { ApprovalGatesService } from './approval-gates.service'
import { ApprovalGatesController } from './approval-gates.controller'
import { MissionModule } from '../mission/mission.module'
import { WorkflowModule } from '../workflow/workflow.module'

@Global()
@Module({
  // MissionModule + WorkflowModule para o gate→resume no controller.
  // Sem ciclo: nenhum deles importa ApprovalGatesModule (usam o ApprovalGatesService via @Global).
  imports: [MissionModule, WorkflowModule],
  controllers: [ApprovalGatesController],
  providers: [ApprovalGatesService],
  exports: [ApprovalGatesService],
})
export class ApprovalGatesModule {}
