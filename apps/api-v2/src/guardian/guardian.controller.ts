import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common'
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger'
import { IsArray, IsOptional, IsString } from 'class-validator'
import { JwtAuthGuard } from '../core/auth.guard'
import { GuardianService } from './guardian.service'

class AnalyzeDto {
  @IsString()
  projectId!: string

  @IsString()
  repoPath!: string

  @IsArray() @IsString({ each: true })
  changedFiles!: string[]

  @IsOptional() @IsArray() @IsString({ each: true })
  allFiles?: string[]
}

class OverrideDto {
  @IsString()
  reason!: string
}

@ApiTags('guardian')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('guardian')
export class GuardianController {
  constructor(private readonly guardian: GuardianService) {}

  @Post('analyze')
  @ApiOperation({ summary: 'Analisa mudanças de código e gera GuardianReport' })
  analyze(@Body() dto: AnalyzeDto) {
    return this.guardian.analyze(dto)
  }

  @Get('latest/:projectId')
  @ApiOperation({ summary: 'Retorna o último GuardianReport do projeto (cache 10min)' })
  getLatest(@Param('projectId') projectId: string) {
    return this.guardian.getLatest(projectId)
  }

  @Patch(':id/override')
  @ApiOperation({ summary: 'Marca um report como overridden (deploy liberado manualmente)' })
  override(@Param('id') id: string, @Body() dto: OverrideDto) {
    return this.guardian.override(id, dto.reason)
  }
}
