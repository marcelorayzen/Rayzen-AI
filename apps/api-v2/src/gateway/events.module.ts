import { Module } from '@nestjs/common'
import { EventsGateway } from './events.gateway'
import { EventsService } from './events.service'
import { CoreModule } from '../core/core.module'

@Module({
  // CoreModule exporta o JwtModule — o gateway valida o token do `subscribe` com ele,
  // e não com o `JwtAuthGuard`, que usa `ctx.switchToHttp()` e não serve para WS.
  imports:   [CoreModule],
  providers: [EventsGateway, EventsService],
  exports:   [EventsService],
})
export class EventsModule {}
