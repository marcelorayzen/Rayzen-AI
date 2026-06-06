import { Controller, Get } from '@nestjs/common'

@Controller()
export class PingController {
  @Get('ping')
  ping() {
    return { ok: true, ts: new Date().toISOString() }
  }
}
