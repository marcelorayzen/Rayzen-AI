import { Module } from '@nestjs/common'
import { NotionService } from './notion.service'
import { NotionController } from './notion.controller'
import { PrismaModule } from '../../prisma/prisma.module'

@Module({
  imports: [PrismaModule],
  providers: [NotionService],
  controllers: [NotionController],
  exports: [NotionService],
})
export class NotionModule {}
