import { Module } from '@nestjs/common'
import { ObsidianController } from './obsidian.controller'
import { ObsidianService } from './obsidian.service'
import { ConfigurationModule } from '../configuration/configuration.module'

@Module({
  imports: [ConfigurationModule],
  controllers: [ObsidianController],
  providers: [ObsidianService],
})
export class ObsidianModule {}
