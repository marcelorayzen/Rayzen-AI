import { Global, Module } from '@nestjs/common'
import { SystemStatusService } from './system-status.service'
import { SystemStatusController } from './system-status.controller'

/**
 * `@Global` de propósito: todo ciclo automático precisa bater, e obrigar cada
 * módulo a importar isto seria wiring manual que alguém esquece — a mesma classe
 * de falha do `setCostController()` que nenhum módulo jamais chamou, e que deixou
 * a V2 três meses sem registrar custo.
 */
@Global()
@Module({
  controllers: [SystemStatusController],
  providers:   [SystemStatusService],
  exports:     [SystemStatusService],
})
export class SystemStatusModule {}
