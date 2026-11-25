import { Controller, Post, Get, Body, UseGuards } from '@nestjs/common'
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger'
import { RouterService } from './router.service'
import { JARVISHealthService } from './jarvis-health.service'
import { RouteRequestDto } from './dto/route-request.dto'
import { JwtAuthGuard } from '../core/auth.guard'

@ApiTags('router')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('route')
export class RouterController {
  constructor(
    private readonly router: RouterService,
    private readonly health: JARVISHealthService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Classify intent, run JARVIS health check and dispatch to mission/skill/ai' })
  route(@Body() dto: RouteRequestDto) {
    return this.router.route(dto)
  }

  @Get('health')
  @ApiOperation({ summary: 'JARVIS health check — status de litellm, database e v1bridge' })
  healthCheck() {
    return this.health.check(true)  // force refresh no endpoint explícito
  }
}
