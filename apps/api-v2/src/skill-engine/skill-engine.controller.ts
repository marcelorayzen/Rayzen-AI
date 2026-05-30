import { Controller, Get, Post, Body, Param, Query, UseGuards, HttpCode } from '@nestjs/common'
import { ApiTags, ApiBearerAuth, ApiQuery } from '@nestjs/swagger'
import { IsString, IsNotEmpty, IsOptional, IsBoolean, IsObject } from 'class-validator'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { SkillEngineService } from './skill-engine.service'
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

@ApiTags('skills')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('skills')
export class SkillEngineController {
  constructor(private readonly skillEngine: SkillEngineService) {}

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
}
