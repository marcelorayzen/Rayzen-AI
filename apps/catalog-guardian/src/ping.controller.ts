import { Controller, Get } from '@nestjs/common'
import { Public } from './auth/public.decorator'

@Controller()
export class PingController {
  @Public()
  @Get('ping')
  ping() {
    return { ok: true, service: 'catalog-guardian' }
  }
}
