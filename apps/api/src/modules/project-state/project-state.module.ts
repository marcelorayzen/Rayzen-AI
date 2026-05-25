import { Module, forwardRef } from '@nestjs/common'
import { ProjectStateController } from './project-state.controller'
import { ProjectStateService } from './project-state.service'
import { HealthModule } from '../health/health.module'
import { EventModule } from '../event/event.module'
import { ConfigurationModule } from '../configuration/configuration.module'

@Module({
  imports: [HealthModule, forwardRef(() => EventModule), ConfigurationModule],
  controllers: [ProjectStateController],
  providers: [ProjectStateService],
  exports: [ProjectStateService],
})
export class ProjectStateModule {}
