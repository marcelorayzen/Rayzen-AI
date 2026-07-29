import { Module } from '@nestjs/common'
import { CoreModule } from '../core/core.module'
import { QueryAuditService } from './query-audit.service'
import { AuditController } from './audit.controller'

@Module({
  imports: [CoreModule],
  controllers: [AuditController],
  providers: [QueryAuditService],
  exports: [QueryAuditService],
})
export class AuditModule {}
