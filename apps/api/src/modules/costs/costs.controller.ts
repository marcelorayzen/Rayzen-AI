import { Controller, Get, Query } from '@nestjs/common'
import { ApiTags, ApiQuery } from '@nestjs/swagger'
import { CostsService } from './costs.service'

@ApiTags('costs')
@Controller('costs')
export class CostsController {
  constructor(private readonly svc: CostsService) {}

  @Get('summary')
  @ApiQuery({ name: 'period', required: false, enum: ['today', 'week', 'month', 'all'] })
  @ApiQuery({ name: 'project_id', required: false })
  summary(
    @Query('period') period = 'month',
    @Query('project_id') projectId?: string,
  ) {
    return this.svc.summary(period, projectId)
  }
}
