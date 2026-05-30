import { Global, Module } from '@nestjs/common'
import { SpecialistService } from './specialist.service'
import { SpecialistController } from './specialist.controller'

@Global()
@Module({
  controllers: [SpecialistController],
  providers: [SpecialistService],
  exports: [SpecialistService],
})
export class SpecialistModule {}
