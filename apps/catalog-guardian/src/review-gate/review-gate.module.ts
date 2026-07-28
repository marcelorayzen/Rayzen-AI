import { Module } from '@nestjs/common'
import { CoreModule } from '../core/core.module'
import { ReviewGateService } from './review-gate.service'
import { ReviewGateController } from './review-gate.controller'

@Module({
  imports: [CoreModule],
  controllers: [ReviewGateController],
  providers: [ReviewGateService],
  exports: [ReviewGateService],
})
export class ReviewGateModule {}
