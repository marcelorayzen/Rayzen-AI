import { Module } from '@nestjs/common'
import { CoreModule } from '../core/core.module'
import { QueryAuditService } from './query-audit.service'

@Module({
  imports: [CoreModule],
  providers: [QueryAuditService],
  exports: [QueryAuditService],
})
export class AuditModule {}
