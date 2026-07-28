import { Module } from '@nestjs/common'
import { CatalogRiskScorerService } from './catalog-risk-scorer.service'

@Module({
  providers: [CatalogRiskScorerService],
  exports: [CatalogRiskScorerService],
})
export class RiskScorerModule {}
