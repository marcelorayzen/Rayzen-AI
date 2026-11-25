import {
  IsArray, IsBoolean, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Max, Min,
} from 'class-validator'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import type { ContextSection, WorkMode } from '../context-engine.service'

export type ContextPackScope = 'personal' | 'project'

const SCOPES: ContextPackScope[] = ['personal', 'project']
const MODES: WorkMode[] = ['implementation', 'debugging', 'review', 'architecture', 'study']
const CLASSES = ['decision', 'lesson', 'pattern', 'constraint', 'assumption'] as const

export class IssueContextPackDto {
  @ApiProperty({ enum: SCOPES })
  @IsIn(SCOPES)
  scopeType!: ContextPackScope

  @ApiPropertyOptional({ description: 'Required when scopeType=project' })
  @IsOptional()
  @IsString()
  projectId?: string

  /**
   * Consumidor, sessão e finalidade são obrigatórios porque é isso que separa um pacote
   * de uma consulta: sem eles, a evidência responde "alguém leu algo", que não é
   * auditoria. O principal NÃO entra aqui — vem do guard.
   */
  @ApiProperty({ description: 'Who reads it, e.g. hermes | claude-code | web' })
  @IsString()
  @IsNotEmpty()
  consumer!: string

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  sessionId!: string

  @ApiProperty({ description: 'Why this read is authorized' })
  @IsString()
  @IsNotEmpty()
  purpose!: string

  @ApiPropertyOptional({ enum: MODES })
  @IsOptional()
  @IsIn(MODES)
  mode?: WorkMode

  @ApiPropertyOptional({ description: 'Task text used by the volatile sections' })
  @IsOptional()
  @IsString()
  query?: string

  @ApiPropertyOptional({ enum: CLASSES, isArray: true, description: 'Knowledge types allowed in; omitted means all' })
  @IsOptional()
  @IsArray()
  @IsIn(CLASSES, { each: true })
  classes?: Array<(typeof CLASSES)[number]>

  @ApiPropertyOptional({ isArray: true, description: 'Volatile context sections; omitted means the mode default' })
  @IsOptional()
  @IsArray()
  sections?: ContextSection[]

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  maxItems?: number

  @ApiPropertyOptional({ default: 12000 })
  @IsOptional()
  @IsInt()
  @Min(200)
  @Max(200_000)
  maxChars?: number

  @ApiPropertyOptional({ default: 30, description: 'How long the read authorization lasts' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1440)
  authorizationMinutes?: number

  /**
   * Fora por padrão. Ligado, exige o dono autenticado e marca cada item como candidato
   * no manifesto e no texto — um candidato pode ser lido, nunca servido como fato.
   */
  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  includeCandidates?: boolean
}
