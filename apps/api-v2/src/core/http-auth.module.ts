import { Module } from '@nestjs/common'
import { APP_GUARD } from '@nestjs/core'
import { JwtAuthGuard } from './auth.guard'

@Module({
  providers: [
    // Fecha a API HTTP por padrão. Rotas públicas precisam declarar @Public().
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class HttpAuthModule {}
