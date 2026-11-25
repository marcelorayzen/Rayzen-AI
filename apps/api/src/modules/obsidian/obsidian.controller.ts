import { Controller, Post, Param, Query } from '@nestjs/common'
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger'
import { ObsidianService } from './obsidian.service'

@ApiTags('obsidian')
@Controller('obsidian')
export class ObsidianController {
  constructor(private readonly svc: ObsidianService) {}

  @Post('sync/:projectId')
  @ApiOperation({ summary: 'Sincroniza docs do projeto com o vault Obsidian' })
  @ApiQuery({ name: 'force', required: false, description: 'Sobrescreve mesmo com conflito' })
  sync(@Param('projectId') projectId: string, @Query('force') force?: string) {
    return this.svc.sync(projectId, force === 'true')
  }
}
