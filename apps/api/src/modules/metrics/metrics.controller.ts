import { Controller, Get, Header } from '@nestjs/common'
import { ApiTags, ApiOperation } from '@nestjs/swagger'
import { SkipThrottle } from '@nestjs/throttler'
import { MetricsService } from './metrics.service'

@SkipThrottle()
@ApiTags('observability')
@Controller('metrics')
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Get()
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  @ApiOperation({ summary: 'Prometheus metrics — requer JWT' })
  async getMetrics(): Promise<string> {
    return this.metrics.getMetrics()
  }
}
