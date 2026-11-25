import { Module } from '@nestjs/common'
import { TelegramService } from './telegram.service'
import { TelegramController } from './telegram.controller'

// Desde a S5.6 (21/11) o módulo só envia avisos: sem leitura de mensagens, ele não precisa mais de
// projeto, estado, grafo, sessão nem respostas pendentes. Menos dependência também é menos chance de
// fechar ciclo de módulos (ver `sem-ciclo-de-modulos.spec.ts`).
@Module({
  controllers: [TelegramController],
  providers: [TelegramService],
  exports: [TelegramService],
})
export class TelegramModule {}
