import { Controller, Post, Body, UseGuards } from '@nestjs/common'
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger'
import { RouterService } from './router.service'
import { RouteRequestDto } from './dto/route-request.dto'
import { JwtAuthGuard } from '../core/auth.guard'

@ApiTags('router')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('route')
export class RouterController {
  constructor(private readonly router: RouterService) {}

  @Post()
  route(@Body() dto: RouteRequestDto) {
    return this.router.route(dto)
  }
}
