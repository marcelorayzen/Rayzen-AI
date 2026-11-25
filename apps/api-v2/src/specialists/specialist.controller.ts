import { Controller, Get, Post, Body, Param, UseGuards, HttpCode } from '@nestjs/common'
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger'
import { IsString, IsNotEmpty, IsOptional, IsIn } from 'class-validator'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { SpecialistService } from './specialist.service'
import { SpecialistType } from './specialist-registry'
import { JwtAuthGuard } from '../core/auth.guard'

const TYPES: SpecialistType[] = ['coder','reviewer','tester','architect','researcher','debugger']

class SpawnDto {
  @ApiProperty()
  @IsString() @IsNotEmpty()
  task!: string

  @ApiProperty()
  @IsString() @IsNotEmpty()
  missionId!: string

  @ApiProperty()
  @IsString() @IsNotEmpty()
  stepId!: string

  @ApiProperty()
  @IsString() @IsNotEmpty()
  projectId!: string

  @ApiPropertyOptional({ enum: TYPES })
  @IsOptional() @IsIn(TYPES)
  type?: SpecialistType

  @ApiPropertyOptional()
  @IsOptional() @IsString()
  context?: string
}

@ApiTags('specialists')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('specialists')
export class SpecialistController {
  constructor(private readonly specialists: SpecialistService) {}

  @Get('types')
  types() { return this.specialists.getTypes() }

  @Get('active')
  active() { return this.specialists.listActive() }

  @Post('spawn')
  @HttpCode(200)
  spawn(@Body() dto: SpawnDto) { return this.specialists.spawn(dto) }

  @Get(':id')
  status(@Param('id') id: string) {
    return this.specialists.getStatus(id) ?? { error: 'Not found' }
  }

  @Post(':id/interrupt')
  @HttpCode(200)
  interrupt(@Param('id') id: string) { return this.specialists.interrupt(id) }
}
