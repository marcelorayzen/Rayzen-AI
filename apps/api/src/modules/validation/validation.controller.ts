import { Controller, Post, Body } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { SkipThrottle } from '@nestjs/throttler'
import { ValidationService } from './validation.service'
import { IsString, IsOptional, IsBoolean } from 'class-validator'

class ValidatePromptDto {
  @IsString()
  prompt!: string
}

class ValidateOutputDto {
  @IsString()
  output!: string

  @IsOptional()
  @IsBoolean()
  expectJson?: boolean
}

@SkipThrottle()
@ApiTags('validation')
@Controller('validation')
export class ValidationController {
  constructor(private readonly svc: ValidationService) {}

  @Post('prompt')
  validatePrompt(@Body() dto: ValidatePromptDto) {
    return this.svc.validatePrompt(dto.prompt)
  }

  @Post('output')
  validateOutput(@Body() dto: ValidateOutputDto) {
    return this.svc.validateOutput(dto.output, dto.expectJson)
  }
}
