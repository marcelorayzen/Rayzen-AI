import { Module } from '@nestjs/common'
import { APP_GUARD } from '@nestjs/core'
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler'
import { PingController } from './ping.controller'
import { ApiKeyGuard } from './auth/api-key.guard'
import { CoreModule } from './core/core.module'
import { AdaptersModule } from './adapters/adapters.module'
import { SyncModule } from './sync/sync.module'
import { PermissionGuardModule } from './permission-guard/permission-guard.module'
import { RiskScorerModule } from './risk-scorer/risk-scorer.module'
import { ReviewGateModule } from './review-gate/review-gate.module'
import { AuditModule } from './audit/audit.module'
import { LlmModule } from './llm/llm.module'
import { QueryModule } from './query/query.module'
import { CatalogModule } from './catalog/catalog.module'
import { CatalogMaturityModule } from './maturity/catalog-maturity.module'
import { CatalogProactiveModule } from './proactive/catalog-proactive.module'
import { GovernancePolicyModule } from './governance-policy/governance-policy.module'

@Module({
  controllers: [PingController],
  imports: [
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 120 }]),
    CoreModule,
    AdaptersModule,
    SyncModule,
    LlmModule,
    PermissionGuardModule,
    RiskScorerModule,
    ReviewGateModule,
    AuditModule,
    QueryModule,
    CatalogModule,
    CatalogProactiveModule,
    CatalogMaturityModule,
    GovernancePolicyModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: ApiKeyGuard },
  ],
})
export class AppModule {}
