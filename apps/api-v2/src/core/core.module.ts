import { Global, Module } from '@nestjs/common'
import { JwtModule } from '@nestjs/jwt'
import { PrismaV2Service } from './prisma-v2.service'
import { V1BridgeService } from './v1-bridge.service'

@Global()
@Module({
  imports: [
    JwtModule.register({
      secret: process.env.JWT_SECRET ?? 'changeme',
      signOptions: { expiresIn: '30d' },
    }),
  ],
  providers: [PrismaV2Service, V1BridgeService],
  exports: [PrismaV2Service, V1BridgeService, JwtModule],
})
export class CoreModule {}
