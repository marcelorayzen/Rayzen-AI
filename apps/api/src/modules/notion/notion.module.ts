import { Module } from '@nestjs/common'
import { NotionService } from './notion.service'
import { NotionController } from './notion.controller'
import { PrismaModule } from '../../prisma/prisma.module'
import { ConfigurationModule } from '../configuration/configuration.module'

@Module({
  imports: [PrismaModule, ConfigurationModule],
  providers: [NotionService],
  controllers: [NotionController],
  exports: [NotionService],
})
export class NotionModule {}
