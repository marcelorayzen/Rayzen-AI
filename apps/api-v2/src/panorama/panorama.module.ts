import { Module } from '@nestjs/common'
import { CoreModule } from '../core/core.module'
import { InvariantsModule } from '../invariants/invariants.module'
import { PanoramaController } from './panorama.controller'
import { PanoramaService } from './panorama.service'

/**
 * Módulo próprio em vez de acrescentar ao `SystemStatusModule`, e o motivo é o ciclo de 14/09.
 *
 * `SystemStatusModule` é `@Global` e **não importa nada** — é isso que o mantém seguro: todo
 * ciclo automático recebe o `beat()` sem wiring manual. Pôr aqui uma dependência de
 * `InvariantsModule` faria um módulo global depender de um módulo de domínio, que é o caminho
 * mais curto para fechar grafo quando o próximo importador aparecer.
 *
 * Assim a direção é única: `PanoramaModule → InvariantsModule`, e o `SystemStatusService` chega
 * pelo `@Global` sem import nenhum. `aplicacao-sobe.spec.ts` confere que o grafo monta.
 *
 * `InvariantsModule` entra só pela constante `HEARTBEAT_HORAS` — o painel precisa do MESMO
 * limiar de idade que o ciclo usa para gravar, senão um relatório de 8h é "velho" de um lado e
 * "fresco" do outro.
 */
@Module({
  imports:     [CoreModule, InvariantsModule],
  controllers: [PanoramaController],
  providers:   [PanoramaService],
  exports:     [PanoramaService],
})
export class PanoramaModule {}
