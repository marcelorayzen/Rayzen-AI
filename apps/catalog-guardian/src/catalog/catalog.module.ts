import { Module } from '@nestjs/common'
import { CoreModule } from '../core/core.module'
import { CatalogReadController } from './catalog-read.controller'

@Module({
  imports: [CoreModule],
  controllers: [CatalogReadController],
})
export class CatalogModule {}
