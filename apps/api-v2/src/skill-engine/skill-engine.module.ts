import { Global, Module } from '@nestjs/common'
import { SkillEngineService } from './skill-engine.service'
import { SkillEngineController } from './skill-engine.controller'
import { SkillRegistryService } from './skill-registry.service'

@Global()
@Module({
  controllers: [SkillEngineController],
  providers:   [SkillRegistryService, SkillEngineService],
  exports:     [SkillEngineService, SkillRegistryService],
})
export class SkillEngineModule {}
