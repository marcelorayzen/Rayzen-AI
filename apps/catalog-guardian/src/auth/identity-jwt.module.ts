import { Module } from '@nestjs/common'
import { JwtModule } from '@nestjs/jwt'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { IdentityGuard } from './identity.guard'

// Backlog "identidade do usuário de negócio" — /query não confia mais num
// userId solto no body (o chamador podia alegar ser qualquer um). O backend
// do cliente, que já autentica seu usuário final no próprio login, assina um
// JWT com claim `sub: userId` usando este secret compartilhado; este adapter
// só verifica a assinatura, nunca emite token nenhum (não é um servidor de
// login). Mesmo padrão de fail-fast no boot do AuthModule de apps/api —
// não faz sentido subir servindo /query sem conseguir verificar identidade.
@Module({
  imports: [
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const secret = config.get<string>('CATALOG_GUARDIAN_IDENTITY_JWT_SECRET')
        if (!secret && process.env.NODE_ENV !== 'test' && !process.env.JEST_WORKER_ID) {
          throw new Error(
            'CATALOG_GUARDIAN_IDENTITY_JWT_SECRET não definido — o servidor se recusa a subir sem secret explícito (ver README § Autenticação)',
          )
        }
        return { secret: secret ?? 'test-secret' }
      },
    }),
  ],
  providers: [IdentityGuard],
  // Exporta JwtModule também, não só IdentityGuard: @UseGuards(IdentityGuard)
  // no controller resolve a guard via injector do módulo que DECLARA o
  // controller (QueryModule), não deste módulo — sem reexportar JwtModule,
  // esse injector não enxerga a dependência JwtService do construtor da guard.
  exports: [IdentityGuard, JwtModule],
})
export class IdentityJwtModule {}
