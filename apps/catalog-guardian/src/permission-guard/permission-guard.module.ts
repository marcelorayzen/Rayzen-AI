import { Module } from '@nestjs/common'
import { AdaptersModule } from '../adapters/adapters.module'
import { CoreModule } from '../core/core.module'
import { PermissionGuardService } from './permission-guard.service'

@Module({
  imports: [AdaptersModule, CoreModule],
  providers: [PermissionGuardService],
  exports: [PermissionGuardService],
})
export class PermissionGuardModule {}
