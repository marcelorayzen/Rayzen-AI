import { Controller, Post, Get, Body, UseGuards, HttpCode } from '@nestjs/common'
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger'
import { AiRouterService } from './ai-router.service'
import { AiRequestDto } from './dto/ai-request.dto'
import { JwtAuthGuard } from '../core/auth.guard'

@ApiTags('ai-router')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('ai')
export class AiRouterController {
  constructor(private readonly aiRouter: AiRouterService) {}

  @Post('complete')
  @HttpCode(200)
  complete(@Body() dto: AiRequestDto) {
    return this.aiRouter.complete(dto)
  }

  @Get('models')
  models() {
    return this.aiRouter.getModels()
  }
}
