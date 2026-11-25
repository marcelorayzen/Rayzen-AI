import { Global, Module } from '@nestjs/common'
import { VaultService } from './vault.service'
import { VaultScanService } from './vault-scan.service'
import { VaultController } from './vault.controller'

@Global()
@Module({
  controllers: [VaultController],
  providers: [VaultService, VaultScanService],
  exports: [VaultService, VaultScanService],
})
export class VaultModule {}
