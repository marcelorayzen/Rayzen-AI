import { Module, forwardRef } from '@nestjs/common'
import { ProjectController } from './project.controller'
import { ProjectService } from './project.service'
import { NotionModule } from '../notion/notion.module'

@Module({
  imports: [forwardRef(() => NotionModule)],
  controllers: [ProjectController],
  providers: [ProjectService],
  exports: [ProjectService],
})
export class ProjectModule {}
