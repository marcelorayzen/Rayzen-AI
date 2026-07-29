import { Module } from '@nestjs/common'
import { CoreModule } from '../core/core.module'
import { CatalogProactiveService } from './catalog-proactive.service'
import { CatalogProactiveController } from './catalog-proactive.controller'

@Module({
  imports: [CoreModule],
  controllers: [CatalogProactiveController],
  providers: [CatalogProactiveService],
  exports: [CatalogProactiveService],
})
export class CatalogProactiveModule {}
