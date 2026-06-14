import { Controller, Post, Get, Delete, Body, Param, Query, UseGuards, HttpCode } from '@nestjs/common'
import { ApiTags, ApiBearerAuth, ApiQuery } from '@nestjs/swagger'
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

class SurgicalContextDto {
  @ApiProperty({ description: 'V1 project ID' })
  @IsString()
  @IsNotEmpty()
  projectId!: string

  @ApiProperty({ description: 'Task or question that determines which knowledge to pull' })
  @IsString()
  @IsNotEmpty()
  task!: string

  @ApiPropertyOptional({ enum: ['implementation', 'debugging', 'review', 'architecture', 'study'] })
  @IsOptional()
  @IsIn(['implementation', 'debugging', 'review', 'architecture', 'study'])
  mode?: WorkMode
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

  /**
   * Transparency endpoint: previews the exact compressed context the Broker would
   * inject into the agent/LLM prompt, plus a token estimate. Powers the Work Panel ContextBadge.
   */
  @Get('preview')
  @ApiQuery({ name: 'projectId', required: true })
  @ApiQuery({ name: 'mode', required: false, enum: ['implementation', 'debugging', 'review', 'architecture', 'study'] })
  @ApiQuery({ name: 'query', required: false })
  async preview(
    @Query('projectId') projectId: string,
    @Query('mode') mode?: WorkMode,
    @Query('query') query?: string,
  ) {
    const built = await this.ctx.build({ projectId, mode, query })
    return {
      ...built,
      estimatedTokens: Math.ceil(built.totalChars / 4),
      sectionsIncluded: Object.keys(built.sections),
    }
  }

  /**
   * Context Broker — pacote cirúrgico para injeção no Claude.
   * Retorna ProjectState + Planning + Policy + KnowledgeGraph relevante + Memória semântica.
   * `readyToInject` é o texto final que pode ser usado diretamente como system prompt prefix.
   */
  @Post('surgical')
  @HttpCode(200)
  surgical(@Body() dto: SurgicalContextDto) {
    return this.ctx.buildSurgical(dto)
  }

  @Delete('cache/:projectId')
  @HttpCode(204)
  invalidate(@Param('projectId') projectId: string) {
    this.ctx.invalidateCache(projectId)
  }
}
