import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards, HttpCode } from '@nestjs/common'
import { ApiTags, ApiBearerAuth, ApiQuery } from '@nestjs/swagger'
import { IsString, IsNotEmpty, IsOptional, IsBoolean, IsObject, IsIn, IsArray, IsNumber } from 'class-validator'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { SkillEngineService } from './skill-engine.service'
import { SkillRegistryService, CreateSkillAssetDto } from './skill-registry.service'
import { JwtAuthGuard } from '../core/auth.guard'

class SkillRunDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  skillId!: string

  @ApiProperty()
  @IsObject()
  input!: Record<string, unknown>

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  projectId?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  missionId?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  stepId?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean
}

class CreateAssetDto implements CreateSkillAssetDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  skillId!: string

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  name!: string

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  description!: string

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  category!: Parameters<typeof SkillRegistryService.prototype.create>[0]['category']

  @ApiProperty({ enum: ['none', 'low', 'medium', 'high'] })
  @IsIn(['none', 'low', 'medium', 'high'])
  risk!: 'none' | 'low' | 'medium' | 'high'

  @ApiProperty({ enum: ['in-process', 'agent-desktop', 'agent-server'] })
  @IsIn(['in-process', 'agent-desktop', 'agent-server'])
  runtime!: 'in-process' | 'agent-desktop' | 'agent-server'

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  version?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  inputSchema?: Record<string, unknown>

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  outputSchema?: Record<string, unknown>

  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  tags?: string[]

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  owner?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  estimatedMs?: number
}

class PatchAssetDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  enabled?: boolean

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  tags?: string[]

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  version?: string

  @ApiPropertyOptional({ enum: ['none', 'low', 'medium', 'high'] })
  @IsOptional()
  @IsIn(['none', 'low', 'medium', 'high'])
  risk?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  estimatedMs?: number
}

@ApiTags('skills')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('skills')
export class SkillEngineController {
  constructor(
    private readonly skillEngine: SkillEngineService,
    private readonly registry:   SkillRegistryService,
  ) {}

  // ─── Listagem e execução ──────────────────────────────────────────────────────

  @Get()
  @ApiQuery({ name: 'category', required: false })
  list(@Query('category') category?: string) {
    return this.skillEngine.listSkills(category)
  }

  @Get('categories')
  categories() {
    return this.skillEngine.getCategories()
  }

  @Get(':id')
  getOne(@Param('id') id: string) {
    return this.skillEngine.getSkill(id)
  }

  @Post('run')
  @HttpCode(200)
  run(@Body() dto: SkillRunDto) {
    return this.skillEngine.run(dto)
  }

  @Post('dry-run')
  @HttpCode(200)
  dryRun(@Body() dto: SkillRunDto) {
    return this.skillEngine.run({ ...dto, dryRun: true })
  }

  // ─── Asset Registry (SkillOpt) ────────────────────────────────────────────────

  /** Registra ou sobrescreve uma skill no DB. */
  @Post('assets')
  createAsset(@Body() dto: CreateAssetDto) {
    return this.registry.create(dto)
  }

  /** Atualiza enabled, tags, risk, version ou description de uma skill. */
  @Patch('assets/:skillId')
  updateAsset(@Param('skillId') skillId: string, @Body() dto: PatchAssetDto) {
    return this.registry.updateAsset(skillId, dto)
  }

  /** Remove um asset custom (não remove skills built-in da execução — só do DB). */
  @Delete('assets/:skillId')
  @HttpCode(204)
  deleteAsset(@Param('skillId') skillId: string) {
    return this.registry.deleteAsset(skillId)
  }

  /**
   * Sincroniza todas as skills estáticas do registry para o DB.
   * Útil para popular o DB na primeira vez ou após adicionar skills no código.
   */
  @Post('assets/sync')
  @HttpCode(200)
  syncAssets() {
    return this.registry.sync()
  }

  // ─── Stats ────────────────────────────────────────────────────────────────────

  /** Estatísticas de uso por projeto: top skills, success rate, logs recentes. */
  @Get('stats/project/:projectId')
  projectStats(@Param('projectId') projectId: string) {
    return this.registry.getProjectStats(projectId)
  }

  /** Estatísticas de uso de uma skill específica (todos os projetos). */
  @Get('stats/skill/:skillId')
  skillStats(@Param('skillId') skillId: string) {
    return this.registry.getSkillStats(skillId)
  }
}
