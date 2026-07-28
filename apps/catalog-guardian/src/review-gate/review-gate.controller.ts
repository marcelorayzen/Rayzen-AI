import { Body, Controller, Get, Param, Patch } from '@nestjs/common'
import { ReviewGateService } from './review-gate.service'

@Controller('review-gates')
export class ReviewGateController {
  constructor(private readonly reviewGates: ReviewGateService) {}

  @Get('pending')
  findPending() {
    return this.reviewGates.findPending()
  }

  @Get('history')
  history() {
    return this.reviewGates.history()
  }

  @Patch(':id/approve')
  approve(@Param('id') id: string, @Body() body: { decidedBy: string; comment?: string }) {
    return this.reviewGates.approve(id, body.decidedBy, body.comment)
  }

  @Patch(':id/reject')
  reject(@Param('id') id: string, @Body() body: { decidedBy: string; comment?: string }) {
    return this.reviewGates.reject(id, body.decidedBy, body.comment)
  }
}
