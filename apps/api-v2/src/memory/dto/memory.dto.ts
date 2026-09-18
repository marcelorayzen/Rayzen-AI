import { IsString, IsNotEmpty, IsOptional, IsIn, IsArray, IsNumber, Min, Max } from 'class-validator'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

export type MemoryClass = 'inbox' | 'working' | 'consolidated' | 'archive'

/**
 * Natureza do que está sendo lembrado. Herdado do módulo `project-memory`,
 * removido em 2026-08-15 por ser um segundo escritor da mesma tabela — ver
 * docs/FROZEN.md. O tipo veio junto porque a coluna já existe no schema e
 * preenchê-la é o que torna possível perguntar "quais decisões foram tomadas"
 * em vez de só buscar por similaridade.
 */
export type MemoryType = 'decision' | 'lesson' | 'pattern' | 'constraint' | 'assumption'
export type WorkMode   = 'implementation' | 'debugging' | 'review' | 'architecture' | 'study'

const MEMORY_CLASSES: MemoryClass[] = ['inbox', 'working', 'consolidated', 'archive']
const MEMORY_TYPES: MemoryType[] = ['decision', 'lesson', 'pattern', 'constraint', 'assumption']
const WORK_MODES: WorkMode[] = ['implementation', 'debugging', 'review', 'architecture', 'study']

export class StoreMemoryDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  projectId!: string

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  content!: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  sourcePath?: string

  @ApiPropertyOptional({ enum: ['file', 'url', 'github', 'notion', 'manual', 'ai_generated'] })
  @IsOptional()
  @IsString()
  sourceType?: string

  @ApiPropertyOptional({ enum: MEMORY_CLASSES, default: 'inbox' })
  @IsOptional()
  @IsIn(MEMORY_CLASSES)
  memoryClass?: MemoryClass

  @ApiPropertyOptional({ enum: MEMORY_TYPES })
  @IsOptional()
  @IsIn(MEMORY_TYPES)
  memoryType?: MemoryType

  @ApiPropertyOptional({ minimum: 0, maximum: 1, default: 0.8 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  confidence?: number

  @ApiPropertyOptional({ description: 'Missão que originou este aprendizado' })
  @IsOptional()
  @IsString()
  missionId?: string
}

export class SearchMemoryDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  query!: string

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  projectId!: string

  @ApiPropertyOptional({ isArray: true, enum: MEMORY_CLASSES })
  @IsOptional()
  @IsArray()
  classes?: MemoryClass[]

  @ApiPropertyOptional({ default: 10, minimum: 1, maximum: 50 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(50)
  limit?: number

  @ApiPropertyOptional({ enum: WORK_MODES })
  @IsOptional()
  @IsIn(WORK_MODES)
  mode?: WorkMode
}

export class UpdateClassDto {
  @ApiProperty({ enum: MEMORY_CLASSES })
  @IsIn(MEMORY_CLASSES)
  memoryClass!: MemoryClass
}
