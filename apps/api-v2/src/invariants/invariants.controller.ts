import { Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common'
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger'
import { JwtAuthGuard } from '../core/auth.guard'
import { InvariantsService } from './invariants.service'

@ApiTags('invariants')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('invariants')
export class InvariantsController {
  constructor(private readonly svc: InvariantsService) {}

  @Get('catalogo')
  @ApiOperation({ summary: 'Lista os invariantes verificados e por que cada um existe' })
  catalogo() {
    return this.svc.catalogo()
  }

  @Post('run/:projectId')
  @ApiOperation({ summary: 'Roda todos os invariantes e grava o relatório' })
  run(@Param('projectId') projectId: string) {
    return this.svc.run(projectId)
  }

  @Get('latest/:projectId')
  @ApiOperation({ summary: 'Último relatório de invariantes do projeto' })
  latest(@Param('projectId') projectId: string) {
    return this.svc.latest(projectId)
  }

  @Get('history/:projectId')
  @ApiOperation({ summary: 'Histórico de relatórios de invariantes' })
  @ApiQuery({ name: 'limit', required: false })
  history(@Param('projectId') projectId: string, @Query('limit') limit?: string) {
    return this.svc.history(projectId, limit ? parseInt(limit, 10) : undefined)
  }
}
