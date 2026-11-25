import { Controller, Get, Post, Param, Body, UseGuards, HttpCode } from '@nestjs/common'
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger'
import { IsString, IsNotEmpty } from 'class-validator'
import { ApiProperty } from '@nestjs/swagger'
import { WorkflowEngineService } from './workflow-engine.service'
import { JwtAuthGuard } from '../core/auth.guard'

class ApplyTemplateDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  templateType!: string
}

class ExecuteDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  projectId!: string
}

@ApiTags('workflows')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('workflows')
export class WorkflowController {
  constructor(private readonly engine: WorkflowEngineService) {}

  @Get('templates')
  templates() {
    return this.engine.getTemplates()
  }

  @Post('missions/:id/execute')
  @HttpCode(200)
  execute(@Param('id') id: string, @Body() dto: ExecuteDto) {
    return this.engine.execute(id, dto.projectId)
  }

  @Post('missions/:id/template')
  @HttpCode(200)
  applyTemplate(@Param('id') id: string, @Body() dto: ApplyTemplateDto) {
    return this.engine.applyTemplate(id, dto.templateType)
  }
}
