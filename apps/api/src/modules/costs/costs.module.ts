import { Module } from '@nestjs/common'
import { CostsController } from './costs.controller'
import { CostsService } from './costs.service'
import { ConfigurationModule } from '../configuration/configuration.module'

@Module({
  // O modelo de alguns módulos é decidido em runtime pela configuração, não por constante.
  imports: [ConfigurationModule],
  controllers: [CostsController],
  providers: [CostsService],
})
export class CostsModule {}
