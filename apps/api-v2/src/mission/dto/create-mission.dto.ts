import { IsString, IsNotEmpty, IsOptional, IsArray, IsObject } from 'class-validator'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

export class CreateMissionDto {
  @ApiProperty({ description: 'ID do projeto V1 ao qual a missão pertence' })
  @IsString()
  @IsNotEmpty()
  projectId!: string

  @ApiProperty({ description: 'Título curto da missão' })
  @IsString()
  @IsNotEmpty()
  title!: string

  @ApiProperty({ description: 'Objetivo em linguagem natural' })
  @IsString()
  @IsNotEmpty()
  objective!: string

  @ApiPropertyOptional({ description: 'Contexto inicial (JSON livre)' })
  @IsOptional()
  @IsObject()
  context?: Record<string, unknown>
}

export class CreateMissionStepDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  title!: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  skillId?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  prompt?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  input?: Record<string, unknown>

  @ApiPropertyOptional({ enum: ['skill', 'ai', 'human'] })
  @IsOptional()
  @IsString()
  executor?: string

  @ApiPropertyOptional({ description: 'IDs de steps que devem completar antes deste' })
  @IsOptional()
  @IsArray()
  dependsOn?: string[]
}

export class UpdateMissionStepDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  output?: Record<string, unknown>

  @ApiPropertyOptional({ enum: ['pending', 'running', 'done', 'failed', 'skipped'] })
  @IsOptional()
  @IsString()
  status?: string
}
