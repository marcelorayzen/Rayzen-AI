import { Controller, Get, Post, Param } from '@nestjs/common'
import { ApiTags, ApiOperation } from '@nestjs/swagger'
import { ProactiveService } from './proactive.service'

@ApiTags('proactive')
@Controller('projects')
export class ProactiveController {
  constructor(private readonly svc: ProactiveService) {}

  @Get(':id/recommendations')
  @ApiOperation({ summary: 'Recomendações proativas: inatividade, doc desatualizado, bloqueio, inconsistência' })
  get(@Param('id') id: string) {
    return this.svc.getRecommendations(id)
  }

  @Post(':id/recommendations/:recId/dismiss')
  @ApiOperation({ summary: 'Descarta uma recomendação' })
  dismiss(@Param('recId') recId: string) {
    return this.svc.dismiss(recId)
  }
}
