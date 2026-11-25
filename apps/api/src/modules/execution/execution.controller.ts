import { Controller, Post, Body } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { ExecutionService } from './execution.service'
import { IsString, IsOptional, IsNotEmpty, MaxLength } from 'class-validator'

class ExecutionDispatchDto {
  @IsString()
  action!: string

  @IsOptional()
  payload?: Record<string, unknown>

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  idempotencyKey!: string
}

@ApiTags('execution')
@Controller('execution')
export class ExecutionController {
  constructor(private readonly svc: ExecutionService) {}

  @Post('dispatch')
  dispatch(@Body() dto: ExecutionDispatchDto) {
    return this.svc.dispatch(dto.action, dto.payload ?? {}, dto.idempotencyKey)
  }
}
