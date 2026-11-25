import { Controller, Get, Post, Param, Body, UseGuards, HttpCode } from '@nestjs/common'
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger'
import { IsString, IsNotEmpty, IsOptional, IsArray } from 'class-validator'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { DocumentationEngineService, DocType } from './documentation-engine.service'
import { JwtAuthGuard } from '../core/auth.guard'

class GenerateDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  projectId!: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  types?: DocType[]
}

@ApiTags('docs')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('docs')
export class DocumentationEngineController {
  constructor(private readonly docs: DocumentationEngineService) {}

  @Post('generate/:missionId')
  @HttpCode(200)
  generate(@Param('missionId') missionId: string, @Body() dto: GenerateDto) {
    return this.docs.generate(missionId, dto.projectId, dto.types)
  }

  @Get(':projectId')
  list(@Param('projectId') projectId: string) {
    return this.docs.listDocs(projectId)
  }
}
