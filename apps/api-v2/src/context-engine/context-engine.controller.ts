import { Controller, Post, Get, Delete, Body, Param, UseGuards, HttpCode } from '@nestjs/common'
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger'
import { IsString, IsNotEmpty, IsOptional, IsIn, IsArray, IsNumber } from 'class-validator'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { ContextEngineService, WorkMode, ContextSection } from './context-engine.service'
import { JwtAuthGuard } from '../core/auth.guard'

class ContextBuildDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  projectId!: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  taskType?: string

  @ApiPropertyOptional({ enum: ['implementation', 'debugging', 'review', 'architecture', 'study'] })
  @IsOptional()
  @IsIn(['implementation', 'debugging', 'review', 'architecture', 'study'])
  mode?: WorkMode

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  query?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  maxTokens?: number

  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  include?: ContextSection[]
}

@ApiTags('context')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('context')
export class ContextEngineController {
  constructor(private readonly ctx: ContextEngineService) {}

  @Post('build')
  @HttpCode(200)
  build(@Body() dto: ContextBuildDto) {
    return this.ctx.build(dto)
  }

  @Delete('cache/:projectId')
  @HttpCode(204)
  invalidate(@Param('projectId') projectId: string) {
    this.ctx.invalidateCache(projectId)
  }
}
