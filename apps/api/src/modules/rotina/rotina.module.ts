import { Module } from '@nestjs/common'
import { PrismaModule } from '../../prisma/prisma.module'
import { HandoffModule } from '../handoff/handoff.module'
import { RotinaController } from './rotina.controller'
import { RotinaService } from './rotina.service'
import { RotinaDisparoService } from './rotina-disparo.service'
import { RotinaAgendadorService } from './rotina-agendador.service'
import { RotinaGatilhoService } from './rotina-gatilho.service'
import { TelegramModule } from '../telegram/telegram.module'
import { CANAL_DE_AVISO, CanalTelegram } from '../agent-session/canal-de-aviso'

// G6. O disparo cria envelopes pelo `HandoffService` (o mesmo caminho do Hub), e o agendador
// (fatia 5) dispara as rotinas de agenda. O gatilho do GitHub chega na fatia 6.
// G6.5: o aviso sai pelo mesmo `CanalDeAviso` da sessão supervisionada (hoje, o Telegram).
@Module({
  imports: [PrismaModule, HandoffModule, TelegramModule],
  controllers: [RotinaController],
  providers: [
    RotinaService, RotinaDisparoService, RotinaAgendadorService, RotinaGatilhoService,
    { provide: CANAL_DE_AVISO, useClass: CanalTelegram },
  ],
  exports: [RotinaService, RotinaDisparoService],
})
export class RotinaModule {}
