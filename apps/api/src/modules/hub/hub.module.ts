import { Module } from '@nestjs/common'
import { HubThreadService } from './hub-thread.service'
import { HermesRuntimeClient } from './hermes-runtime.client'
import { HubTurnService } from './hub-turn.service'
import { HubController } from './hub.controller'
import { ContextPackClient } from './context-pack.client'
import { HubWorkItemService } from './hub-work-item.service'
import { ExecutionModule } from '../execution/execution.module'
import { HubAnexoService } from './hub-anexo.service'
import { HubAnexoController } from './hub-anexo.controller'
import { HubMemoriaService } from './hub-memoria.service'
import { HubMemoriaController } from './hub-memoria.controller'
import { MemoryModule } from '../memory/memory.module'

@Module({
  // ExecutionModule: o cartão de entrega despacha `open_delivery` ao agent desktop (item 7.2a).
  // MemoryModule: HC4b guarda anexo aprovado na memória do projeto.
  imports: [ExecutionModule, MemoryModule],
  // HC1: anexos do chat, com controller próprio para não mexer no do turno.
  controllers: [HubController, HubAnexoController, HubMemoriaController],
  providers: [HubThreadService, HermesRuntimeClient, ContextPackClient, HubTurnService, HubWorkItemService, HubAnexoService, HubMemoriaService],
  exports: [HubThreadService, HubTurnService, HubAnexoService],
})
export class HubModule {}
