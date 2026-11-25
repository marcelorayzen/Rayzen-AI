import { IsString, IsNotEmpty, IsOptional, IsIn, IsNumber, Min, Max } from 'class-validator'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { AITaskType } from '../ai-router.service'

const TASK_TYPES: AITaskType[] = [
  'classify', 'summarize', 'extract',
  'generate_code', 'review', 'implement',
  'analyze', 'strategic', 'architecture',
]

export class AiRequestDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  prompt!: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  systemPrompt?: string

  @ApiPropertyOptional({ enum: [2, 3, 4], description: 'Tier mínimo a usar' })
  @IsOptional()
  @IsNumber()
  @Min(2)
  @Max(4)
  tier?: 2 | 3 | 4

  @ApiPropertyOptional({ enum: [2, 3, 4], description: 'Tier máximo permitido' })
  @IsOptional()
  @IsNumber()
  @Min(2)
  @Max(4)
  maxTier?: 2 | 3 | 4

  @ApiPropertyOptional({ enum: TASK_TYPES })
  @IsOptional()
  @IsIn(TASK_TYPES)
  taskType?: AITaskType

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  projectId?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  maxTokens?: number
}
