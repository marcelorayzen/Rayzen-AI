import { Controller, Post, Get, Delete, Body, Param, Query, Req, UseGuards, HttpCode } from '@nestjs/common'
import { ApiTags, ApiBearerAuth, ApiQuery } from '@nestjs/swagger'
import { IsString, IsNotEmpty, IsOptional, IsIn, IsArray, IsNumber } from 'class-validator'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { ContextEngineService, WorkMode, ContextSection } from './context-engine.service'
import { ContextPackService } from './context-pack.service'
import { IssueContextPackDto, ContextPackScope } from './dto/context-pack.dto'
import { JwtAuthGuard } from '../core/auth.guard'
import type { AuthenticatedRequest } from '../core/auth.guard'

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
  constructor(
    private readonly ctx: ContextEngineService,
    private readonly packs: ContextPackService,
  ) {}

  /** Emite uma leitura autorizada e reproduzível para um consumidor e uma finalidade. */
  @Post('packs')
  issuePack(@Body() dto: IssueContextPackDto, @Req() req: AuthenticatedRequest) {
    return this.packs.issue(dto, req.authPrincipal!)
  }

  @Get('packs')
  listPacks(
    @Query('scopeType') scopeType?: ContextPackScope,
    @Query('projectId') projectId?: string,
    @Query('consumer') consumer?: string,
    @Query('sessionId') sessionId?: string,
  ) {
    return this.packs.list({ scopeType, projectId, consumer, sessionId })
  }

  /** Manifesto — evidência do que foi servido. Continua respondendo depois da expiração. */
  @Get('packs/:id')
  getPack(@Param('id') id: string) {
    return this.packs.get(id)
  }

  /** Conteúdo — só enquanto a autorização vale, e só para quem a recebeu. */
  @Get('packs/:id/content')
  packContent(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.packs.content(id, req.authPrincipal!)
  }

  @Get('packs/:id/verification')
  verifyPack(@Param('id') id: string) {
    return this.packs.verify(id)
  }

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
