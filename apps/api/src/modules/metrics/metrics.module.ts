import { Module } from '@nestjs/common'
import { BullModule } from '@nestjs/bull'
import { MetricsController } from './metrics.controller'
import { MetricsService } from './metrics.service'
import { AuthModule } from '../auth/auth.module'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'

@Module({
  imports: [
    BullModule.registerQueue({ name: 'agent-tasks' }),
    AuthModule,
  ],
  controllers: [MetricsController],
  providers: [MetricsService, JwtAuthGuard],
  exports: [MetricsService],
})
export class MetricsModule {}
