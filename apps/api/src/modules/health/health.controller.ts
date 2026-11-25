import { Controller, Get, Post, Param, Query } from '@nestjs/common'
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger'
import { HealthScoreService } from './health.service'

@ApiTags('health')
@Controller('projects')
export class HealthController {
  constructor(private readonly svc: HealthScoreService) {}

  @Get(':id/health')
  @ApiOperation({ summary: 'Score atual + histórico dos últimos 30 dias' })
  @ApiQuery({ name: 'days', required: false, type: Number })
  async get(@Param('id') id: string, @Query('days') days?: string) {
    const [current, history] = await Promise.all([
      this.svc.getCurrent(id),
      this.svc.getHistory(id, days ? parseInt(days) : 30),
    ])
    return { current, history }
  }

  @Post(':id/health/compute')
  @ApiOperation({ summary: 'Calcular e persistir health score agora' })
  compute(@Param('id') id: string) {
    return this.svc.compute(id)
  }
}
