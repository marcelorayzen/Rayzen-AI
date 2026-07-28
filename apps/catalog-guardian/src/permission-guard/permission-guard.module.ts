import { Module } from '@nestjs/common'
import { AdaptersModule } from '../adapters/adapters.module'
import { PermissionGuardService } from './permission-guard.service'

@Module({
  imports: [AdaptersModule],
  providers: [PermissionGuardService],
  exports: [PermissionGuardService],
})
export class PermissionGuardModule {}
