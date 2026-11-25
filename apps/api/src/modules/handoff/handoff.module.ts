import { Module } from '@nestjs/common'
import { HandoffController } from './handoff.controller'
import { HandoffService } from './handoff.service'
import { HandoffReconciliationService } from './handoff-reconciliation.service'
import { ExecutionModule } from '../execution/execution.module'
import { AgentBridgeModule } from '../agent-bridge/agent-bridge.module'
import { PrismaService } from '../../prisma/prisma.service'
import { AprovacaoPeloHubController } from './aprovacao-pelo-hub.controller'
import { AprovacaoPeloHubService } from './aprovacao-pelo-hub.service'

/**
 * Importa `ExecutionModule` em vez de reimplementar aprovação e fila.
 *
 * O handoff é a ligação durável entre uma autorização e uma execução; se ele criasse a própria
 * fila ou a própria noção de aprovação, seria um segundo produtor — exatamente o que o "broker
 * único" da direção aprovada existe para impedir.
 */
@Module({
  imports: [ExecutionModule, AgentBridgeModule],
  controllers: [HandoffController, AprovacaoPeloHubController],
  providers: [
    HandoffService,
    HandoffReconciliationService,
    // `useFactory` porque o serviço recebe um relógio injetável (testes) que o Nest não resolve.
    {
      provide: AprovacaoPeloHubService,
      useFactory: (prisma: PrismaService, handoffs: HandoffService) => new AprovacaoPeloHubService(prisma, handoffs),
      inject: [PrismaService, HandoffService],
    },
  ],
  exports: [HandoffService],
})
export class HandoffModule {}
