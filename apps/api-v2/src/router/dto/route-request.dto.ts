import { IsString, IsNotEmpty, IsOptional, IsIn, IsObject } from 'class-validator'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

export class RouteRequestDto {
  @ApiProperty({ description: 'Intenção do usuário em linguagem natural' })
  @IsString()
  @IsNotEmpty()
  content!: string

  @ApiProperty({ description: 'ID do projeto V1' })
  @IsString()
  @IsNotEmpty()
  projectId!: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  sessionId?: string

  @ApiPropertyOptional({ enum: ['auto', 'mission', 'skill', 'chat'], default: 'auto' })
  @IsOptional()
  @IsIn(['auto', 'mission', 'skill', 'chat'])
  mode?: 'auto' | 'mission' | 'skill' | 'chat'

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  context?: Record<string, unknown>
}

export type DecisionType = 'mission' | 'skill' | 'ai' | 'clarification'

export interface RouteDecision {
  type:       DecisionType
  target:     string
  confidence: number
  reasoning:  string
  payload:    Record<string, unknown>
}
