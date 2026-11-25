import { Module } from '@nestjs/common'
import { CoreModule } from '../core/core.module'
import { InvariantsService } from './invariants.service'
import { InvariantsController } from './invariants.controller'

@Module({
  imports:     [CoreModule],
  controllers: [InvariantsController],
  providers:   [InvariantsService],
  exports:     [InvariantsService],
})
export class InvariantsModule {}
