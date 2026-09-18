import { Module } from '@nestjs/common'
import { TelegramService } from './telegram.service'
import { TelegramController } from './telegram.controller'
import { ProjectModule } from '../project/project.module'
import { ProjectStateModule } from '../project-state/project-state.module'
import { GraphModule } from '../graph/graph.module'
import { PrismaModule } from '../../prisma/prisma.module'
// A06: resolve a qual sessão supervisionada pertence uma resposta. Módulo próprio, dependente
// só do Prisma — importar `AgentSessionModule` aqui fecharia ciclo (ele já importa este).
import { PendingReplyModule } from '../agent-session/pending-reply.module'
// Política de sessão compartilhada com a web. `SessionModule` não importa ninguém, então esta
// dependência é folha e não tem como fechar grafo.
import { SessionModule } from '../session/session.module'

@Module({
  imports: [ProjectModule, ProjectStateModule, GraphModule, PrismaModule, PendingReplyModule, SessionModule],
  controllers: [TelegramController],
  providers: [TelegramService],
  exports: [TelegramService],
})
export class TelegramModule {}
