import { Module } from '@nestjs/common'
import { ConfigurationController } from './configuration.controller'
import { RayzenConfigService } from './configuration.service'
import { PrismaModule } from '../../prisma/prisma.module'

@Module({
  imports: [PrismaModule],
  controllers: [ConfigurationController],
  providers: [RayzenConfigService],
  exports: [RayzenConfigService],
})
export class ConfigurationModule {}
