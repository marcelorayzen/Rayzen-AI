import { Module } from '@nestjs/common'
import { SynthesisController } from './synthesis.controller'
import { SynthesisService } from './synthesis.service'
import { SmartCheckpointService } from './smart-checkpoint.service'

@Module({
  controllers: [SynthesisController],
  providers: [SynthesisService, SmartCheckpointService],
  exports: [SynthesisService, SmartCheckpointService],
})
export class SynthesisModule {}
