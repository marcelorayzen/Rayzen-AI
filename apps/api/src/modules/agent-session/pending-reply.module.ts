import { Module } from '@nestjs/common'
import { PendingReplyService } from './pending-reply.service'

/**
 * Módulo próprio, e só por causa de ciclo: `TelegramService` precisa resolver para qual sessão
 * vai uma resposta, e `AgentSessionService` precisa de `TelegramService` para perguntar. Injetar
 * `AgentSessionService` no Telegram fecharia o ciclo — o mesmo motivo pelo qual o
 * `TelegramService` já chama o orquestrador por HTTP em vez de importá-lo.
 *
 * `PendingReplyService` depende só do Prisma (global), então os dois lados podem importá-lo sem
 * que nenhum dependa do outro.
 */
@Module({
  providers: [PendingReplyService],
  exports: [PendingReplyService],
})
export class PendingReplyModule {}
