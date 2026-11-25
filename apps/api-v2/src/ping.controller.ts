import { Controller, Get } from '@nestjs/common'
import { Public } from './core/public.decorator'

@Controller()
export class PingController {
  @Get('ping')
  @Public()
  ping() {
    return { ok: true, ts: new Date().toISOString() }
  }
}
