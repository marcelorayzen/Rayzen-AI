import { Module } from '@nestjs/common'
import { CoreModule } from '../core/core.module'
import { CatalogMaturityService } from './catalog-maturity.service'
import { CatalogMaturityController } from './catalog-maturity.controller'

@Module({
  imports: [CoreModule],
  controllers: [CatalogMaturityController],
  providers: [CatalogMaturityService],
  exports: [CatalogMaturityService],
})
export class CatalogMaturityModule {}
