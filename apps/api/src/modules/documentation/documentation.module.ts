import { Module } from '@nestjs/common'
import { DocumentationController } from './documentation.controller'
import { DocumentationService } from './documentation.service'
import { PrismaModule } from '../../prisma/prisma.module'

@Module({
  imports: [PrismaModule],
  controllers: [DocumentationController],
  providers: [DocumentationService],
  exports: [DocumentationService],
})
export class DocumentationModule {}
