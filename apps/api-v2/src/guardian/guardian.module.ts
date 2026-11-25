import { Module } from '@nestjs/common'
import { CoreModule } from '../core/core.module'
import { TestGapDetectorService } from './test-gap-detector.service'
import { RiskScorerService } from './risk-scorer.service'
import { GuardianService } from './guardian.service'
import { GuardianController } from './guardian.controller'

@Module({
  imports:     [CoreModule],
  controllers: [GuardianController],
  providers:   [TestGapDetectorService, RiskScorerService, GuardianService],
  exports:     [GuardianService],
})
export class GuardianModule {}
