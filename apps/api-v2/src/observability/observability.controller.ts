import { Controller, Get, Param, UseGuards } from '@nestjs/common'
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger'
import { TraceService } from './trace.service'
import { JwtAuthGuard } from '../core/auth.guard'

@ApiTags('observability')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('observe')
export class ObservabilityController {
  constructor(private readonly trace: TraceService) {}

  @Get('trace/:traceId')
  getTrace(@Param('traceId') traceId: string) {
    return this.trace.getTrace(traceId)
  }

  @Get('mission/:missionId')
  getMissionTimeline(@Param('missionId') missionId: string) {
    return this.trace.getMissionTimeline(missionId)
  }

  @Get('errors')
  getErrors() {
    return this.trace.getRecentErrors()
  }
}
