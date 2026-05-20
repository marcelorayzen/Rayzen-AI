import { Module } from '@nestjs/common'
import { DocumentationController } from './documentation.controller'
import { DocumentationService } from './documentation.service'
import { PrismaModule } from '../../prisma/prisma.module'
import { ProjectStateModule } from '../project-state/project-state.module'

@Module({
  imports: [PrismaModule, ProjectStateModule],
  controllers: [DocumentationController],
  providers: [DocumentationService],
  exports: [DocumentationService],
})
export class DocumentationModule {}
