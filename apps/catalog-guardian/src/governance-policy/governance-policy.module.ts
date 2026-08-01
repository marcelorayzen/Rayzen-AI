import { Module } from '@nestjs/common'
import { CoreModule } from '../core/core.module'
import { EmbeddingModule } from '../embedding/embedding.module'
import { GovernancePolicyController } from './governance-policy.controller'
import { GovernancePolicyService } from './governance-policy.service'

@Module({
  imports: [CoreModule, EmbeddingModule],
  controllers: [GovernancePolicyController],
  providers: [GovernancePolicyService],
})
export class GovernancePolicyModule {}
