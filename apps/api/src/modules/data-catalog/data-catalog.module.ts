import { Module } from '@nestjs/common'
import { DataCatalogService } from './data-catalog.service'
import { DataCatalogController } from './data-catalog.controller'
import { PrismaModule } from '../../prisma/prisma.module'
import { MemoryModule } from '../memory/memory.module'

@Module({
  imports: [PrismaModule, MemoryModule],
  controllers: [DataCatalogController],
  providers: [DataCatalogService],
  exports: [DataCatalogService],
})
export class DataCatalogModule {}
