import { Global, Module } from '@nestjs/common'
import { ApprovalGatesService } from './approval-gates.service'
import { ApprovalGatesController } from './approval-gates.controller'

@Global()
@Module({
  controllers: [ApprovalGatesController],
  providers: [ApprovalGatesService],
  exports: [ApprovalGatesService],
})
export class ApprovalGatesModule {}
