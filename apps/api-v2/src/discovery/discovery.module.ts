import { Module } from '@nestjs/common'
import { DiscoveryService } from './discovery.service'
import { DiscoveryController } from './discovery.controller'

@Module({
  controllers: [DiscoveryController],
  providers: [DiscoveryService],
  exports: [DiscoveryService],
})
export class DiscoveryModule {}
