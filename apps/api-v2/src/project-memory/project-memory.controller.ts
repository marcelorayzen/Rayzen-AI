import { Controller, Get, Post, Body, Param, UseGuards, HttpCode } from '@nestjs/common'
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger'
import { IsString, IsNotEmpty, IsOptional, IsNumber, IsIn, IsDate } from 'class-validator'
import { Type } from 'class-transformer'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { ProjectMemoryService, ProjectMemoryType } from './project-memory.service'
import { JwtAuthGuard } from '../core/auth.guard'

const MEMORY_TYPES: ProjectMemoryType[] = ['decision', 'lesson', 'pattern', 'constraint', 'assumption']

class IndexMemoryDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  content!: string

  @ApiProperty({ enum: MEMORY_TYPES })
  @IsIn(MEMORY_TYPES)
  memoryType!: ProjectMemoryType

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  missionId?: string

  @ApiPropertyOptional({ minimum: 0, maximum: 1 })
  @IsOptional()
  @IsNumber()
  confidence?: number

  @ApiPropertyOptional()
  @IsOptional()
  @IsDate()
  @Type(() => Date)
  validUntil?: Date
}

@ApiTags('project-memory')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('projects/:projectId/memory')
export class ProjectMemoryController {
  constructor(private readonly svc: ProjectMemoryService) {}

  @Get()
  summary(@Param('projectId') projectId: string) {
    return this.svc.getSummary(projectId)
  }

  @Get('decisions')
  decisions(@Param('projectId') projectId: string) {
    return this.svc.getDecisions(projectId)
  }

  @Get('failures')
  failures(@Param('projectId') projectId: string) {
    return this.svc.getFailures(projectId)
  }

  @Post('index')
  @HttpCode(200)
  index(@Param('projectId') projectId: string, @Body() dto: IndexMemoryDto) {
    return this.svc.index({ ...dto, projectId })
  }
}
