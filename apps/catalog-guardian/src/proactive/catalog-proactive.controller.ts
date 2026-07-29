import { Controller, Get, Param, Patch } from '@nestjs/common'
import { CatalogProactiveService } from './catalog-proactive.service'

@Controller('proactive')
export class CatalogProactiveController {
  constructor(private readonly svc: CatalogProactiveService) {}

  @Get('recommendations')
  get() {
    return this.svc.getRecommendations()
  }

  @Patch('recommendations/:id/dismiss')
  dismiss(@Param('id') id: string) {
    return this.svc.dismiss(id)
  }
}
