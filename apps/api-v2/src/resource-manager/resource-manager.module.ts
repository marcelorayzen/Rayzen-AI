import { Global, Module } from '@nestjs/common'
import { ResourceManagerService } from './resource-manager.service'
import { ResourceManagerController } from './resource-manager.controller'

@Global()
@Module({
  controllers: [ResourceManagerController],
  providers: [ResourceManagerService],
  exports: [ResourceManagerService],
})
export class ResourceManagerModule {}
