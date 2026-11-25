import { Module } from '@nestjs/common'
import { ValidationController } from './validation.controller'
import { ValidationService } from './validation.service'
import { PromptValidator } from './prompt-validator'
import { OutputValidator } from './output-validator'

@Module({
  controllers: [ValidationController],
  providers: [ValidationService, PromptValidator, OutputValidator],
  exports: [ValidationService],
})
export class ValidationModule {}
