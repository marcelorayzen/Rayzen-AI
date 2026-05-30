import { Global, Module } from '@nestjs/common'
import { SkillEngineService } from './skill-engine.service'
import { SkillEngineController } from './skill-engine.controller'

@Global()
@Module({
  controllers: [SkillEngineController],
  providers: [SkillEngineService],
  exports: [SkillEngineService],
})
export class SkillEngineModule {}
