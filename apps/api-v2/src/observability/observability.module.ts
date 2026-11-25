import { Global, Module } from '@nestjs/common'
import { TraceService } from './trace.service'
import { ObservabilityController } from './observability.controller'

@Global()
@Module({
  controllers: [ObservabilityController],
  providers: [TraceService],
  exports: [TraceService],
})
export class ObservabilityModule {}
