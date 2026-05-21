import { Controller, Post, Body, Param } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { BlueprintService } from './blueprint.service'
import { ImportBlueprintDto } from './dto/import-blueprint.dto'
import { PreviewBlueprintDto } from './dto/preview-blueprint.dto'

@ApiTags('blueprint')
@Controller('blueprint')
export class BlueprintController {
  constructor(private readonly blueprintService: BlueprintService) {}

  @Post('preview')
  preview(@Body() dto: PreviewBlueprintDto) {
    return this.blueprintService.preview(dto)
  }

  @Post('import')
  import(@Body() dto: ImportBlueprintDto) {
    return this.blueprintService.import(dto)
  }
}

@ApiTags('blueprint')
@Controller('projects/:projectId/blueprint')
export class BlueprintProjectController {
  constructor(private readonly blueprintService: BlueprintService) {}

  @Post('import')
  importForProject(
    @Param('projectId') projectId: string,
    @Body() dto: ImportBlueprintDto,
  ) {
    return this.blueprintService.import({ ...dto, projectId })
  }
}
