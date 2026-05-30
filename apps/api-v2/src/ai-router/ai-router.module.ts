import { Global, Module } from '@nestjs/common'
import { AiRouterService } from './ai-router.service'
import { AiRouterController } from './ai-router.controller'

@Global()
@Module({
  controllers: [AiRouterController],
  providers: [AiRouterService],
  exports: [AiRouterService],
})
export class AiRouterModule {}
