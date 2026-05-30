import { Global, Module } from '@nestjs/common'
import { CostControllerService } from './cost-controller.service'
import { CostControllerController } from './cost-controller.controller'

@Global()
@Module({
  controllers: [CostControllerController],
  providers: [CostControllerService],
  exports: [CostControllerService],
})
export class CostControllerModule {}
