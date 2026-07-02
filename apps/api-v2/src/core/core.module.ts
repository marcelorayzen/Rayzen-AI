import { Global, Module } from '@nestjs/common'
import { JwtModule } from '@nestjs/jwt'
import { PrismaV2Service } from './prisma-v2.service'
import { V1BridgeService } from './v1-bridge.service'
import { V1ApiService } from './v1-api.service'

// Fail-fast: sem JWT_SECRET a API aceitaria tokens forjados com um secret
// conhecido — e a V2 fica exposta na internet via Cloudflare Tunnel.
function requireJwtSecret(): string {
  const secret = process.env.JWT_SECRET
  if (secret) return secret
  if (process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID) return 'test-secret'
  throw new Error('JWT_SECRET não definido — a api-v2 se recusa a subir sem secret explícito')
}

@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      useFactory: () => ({
        secret: requireJwtSecret(),
        signOptions: { expiresIn: '30d' },
      }),
    }),
  ],
  providers: [PrismaV2Service, V1BridgeService, V1ApiService],
  exports: [PrismaV2Service, V1BridgeService, V1ApiService, JwtModule],
})
export class CoreModule {}
