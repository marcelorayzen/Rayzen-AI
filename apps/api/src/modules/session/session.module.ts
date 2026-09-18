import { Module } from '@nestjs/common'
import { SessionController } from './session.controller'
import { SessionService } from './session.service'
import { HubIngestGuard } from './hub-ingest.guard'

/**
 * Exporta o service porque a política de sessão passou a ser compartilhada: o Telegram pergunta
 * "em qual fio eu escrevo?" à mesma função que responde à web.
 *
 * Este módulo **não importa ninguém** (só o Prisma global), então quem depender dele nunca fecha
 * grafo — foi por isso que a dependência do Telegram pôde ser direta, sem o `forwardRef` que o
 * ciclo de 14/09 ensinou a evitar.
 */
@Module({
  controllers: [SessionController],
  providers: [SessionService, HubIngestGuard],
  exports: [SessionService],
})
export class SessionModule {}
