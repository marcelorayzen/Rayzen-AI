import { Module } from '@nestjs/common'
import { ExecutionModule } from '../execution/execution.module'
import { ProjectFilesController } from './project-files.controller'
import { ProjectFilesService } from './project-files.service'

@Module({
  imports: [ExecutionModule],
  controllers: [ProjectFilesController],
  providers: [ProjectFilesService],
})
export class ProjectFilesModule {}
