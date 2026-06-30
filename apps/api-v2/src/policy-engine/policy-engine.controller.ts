import {
  Controller, Get, Post, Patch, Delete,
  Param, Body, Query, UseGuards, HttpCode,
} from '@nestjs/common'
import { ApiTags, ApiBearerAuth, ApiQuery } from '@nestjs/swagger'
import { IsString, IsNotEmpty, IsOptional, IsBoolean, IsObject, IsIn } from 'class-validator'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { PolicyEngineService, PolicyContext, PolicyOperation } from './policy-engine.service'
import { JwtAuthGuard } from '../core/auth.guard'

class CreateRuleDto {
  @ApiPropertyOptional({ description: 'null = regra de sistema (vale para todos os projetos)' })
  @IsOptional()
  @IsString()
  projectId?: string

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  name!: string

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  description!: string

  @ApiProperty({ enum: ['warn', 'block', 'gate'] })
  @IsIn(['warn', 'block', 'gate'])
  action!: 'warn' | 'block' | 'gate'

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  enabled?: boolean
}

class UpdateRuleDto {
  @ApiPropertyOptional({ enum: ['warn', 'block', 'gate'] })
  @IsOptional()
  @IsIn(['warn', 'block', 'gate'])
  action?: 'warn' | 'block' | 'gate'

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  enabled?: boolean

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string
}

class EvaluateDto {
  @ApiProperty({ enum: ['knowledge_add', 'knowledge_extract', 'code_commit', 'deployment', 'memory_add', 'specialist_run'] })
  @IsIn(['knowledge_add', 'knowledge_extract', 'code_commit', 'deployment', 'memory_add', 'specialist_run'])
  operation!: PolicyOperation

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  projectId!: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  data?: Record<string, unknown>
}

class CreateExceptionDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  ruleId!: string

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  projectId!: string

  @ApiProperty({ description: 'Motivo da exceção — auditável' })
  @IsString()
  @IsNotEmpty()
  reason!: string

  @ApiProperty({ description: 'Quem concedeu a exceção' })
  @IsString()
  @IsNotEmpty()
  grantedBy!: string

  @ApiPropertyOptional({ description: 'Escopo opcional — { missionId?, stepId? }. Vazio = projeto inteiro' })
  @IsOptional()
  @IsObject()
  scope?: Record<string, unknown>

  @ApiPropertyOptional({ description: 'ISO date — null/omitido = sem expiração' })
  @IsOptional()
  @IsString()
  expiresAt?: string
}

@ApiTags('policy')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('policy')
export class PolicyEngineController {
  constructor(private readonly policy: PolicyEngineService) {}

  @Get('rules')
  @ApiQuery({ name: 'projectId', required: false })
  listRules(@Query('projectId') projectId?: string) {
    return this.policy.listRules(projectId)
  }

  @Post('rules')
  createRule(@Body() dto: CreateRuleDto) {
    return this.policy.createRule(dto)
  }

  @Patch('rules/:id')
  updateRule(@Param('id') id: string, @Body() dto: UpdateRuleDto) {
    return this.policy.updateRule(id, dto)
  }

  @Delete('rules/:id')
  @HttpCode(204)
  deleteRule(@Param('id') id: string) {
    return this.policy.deleteRule(id)
  }

  /** Avalia manualmente uma operação contra as políticas ativas — útil para debug e testes. */
  @Post('evaluate')
  @HttpCode(200)
  evaluate(@Body() dto: EvaluateDto) {
    const ctx: PolicyContext = {
      operation:  dto.operation,
      projectId:  dto.projectId,
      data:       dto.data ?? {},
    }
    return this.policy.evaluate(ctx)
  }

  @Get('exceptions')
  @ApiQuery({ name: 'projectId', required: false })
  @ApiQuery({ name: 'ruleId', required: false })
  listExceptions(@Query('projectId') projectId?: string, @Query('ruleId') ruleId?: string) {
    return this.policy.listExceptions(projectId, ruleId)
  }

  /** Concede uma exceção formal e auditável a uma regra — registrada, não apenas desabilitada. */
  @Post('exceptions')
  createException(@Body() dto: CreateExceptionDto) {
    return this.policy.createException(dto)
  }

  @Delete('exceptions/:id')
  @HttpCode(204)
  revokeException(@Param('id') id: string) {
    return this.policy.revokeException(id)
  }
}
