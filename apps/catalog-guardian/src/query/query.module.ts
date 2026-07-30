import { Module } from '@nestjs/common'
import { CoreModule } from '../core/core.module'
import { PermissionGuardModule } from '../permission-guard/permission-guard.module'
import { RiskScorerModule } from '../risk-scorer/risk-scorer.module'
import { ReviewGateModule } from '../review-gate/review-gate.module'
import { AuditModule } from '../audit/audit.module'
import { LlmModule } from '../llm/llm.module'
import { AdaptersModule } from '../adapters/adapters.module'
import { IdentityJwtModule } from '../auth/identity-jwt.module'
import { QueryService } from './query.service'
import { QueryController } from './query.controller'

@Module({
  imports: [CoreModule, PermissionGuardModule, RiskScorerModule, ReviewGateModule, AuditModule, LlmModule, AdaptersModule, IdentityJwtModule],
  controllers: [QueryController],
  providers: [QueryService],
  exports: [QueryService],
})
export class QueryModule {}
