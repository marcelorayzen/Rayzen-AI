import { Module } from '@nestjs/common'
import { JwtModule } from '@nestjs/jwt'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { AuthController } from './auth.controller'
import { AuthService } from './auth.service'

@Module({
  imports: [
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const secret = config.get<string>('JWT_SECRET')
        // Fail-fast no boot: sem secret, @nestjs/jwt só falharia por requisição,
        // com erro genérico — e a API está exposta via Cloudflare Tunnel.
        if (!secret && process.env.NODE_ENV !== 'test' && !process.env.JEST_WORKER_ID) {
          throw new Error('JWT_SECRET não definido — a api se recusa a subir sem secret explícito')
        }
        return {
          secret: secret ?? 'test-secret',
          // 30d para alinhar com o max-age do cookie no web — evita expirar
          // silenciosamente no meio do uso (rotas não-guardadas mascaram o 401).
          signOptions: { expiresIn: '30d' },
        }
      },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService],
  exports: [AuthService, JwtModule],
})
export class AuthModule {}
