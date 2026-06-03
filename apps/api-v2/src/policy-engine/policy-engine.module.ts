import { Global, Module } from '@nestjs/common'
import { PolicyEngineService } from './policy-engine.service'
import { PolicyEngineController } from './policy-engine.controller'

@Global()
@Module({
  controllers: [PolicyEngineController],
  providers:   [PolicyEngineService],
  exports:     [PolicyEngineService],
})
export class PolicyEngineModule {}
