import { Module } from '@nestjs/common'
import { DataQualityService } from './data-quality.service'
import { DataQualityController } from './data-quality.controller'
import { PrismaModule } from '../../prisma/prisma.module'

@Module({
  imports: [PrismaModule],
  controllers: [DataQualityController],
  providers: [DataQualityService],
  exports: [DataQualityService],
})
export class DataQualityModule {}
