import {
  IsIn, IsISO8601, IsNotEmpty, IsObject, IsOptional, IsString,
} from 'class-validator'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import type { MemoryType } from './memory.dto'

export type KnowledgeScope = 'personal' | 'project'
export type ProposalStatus = 'candidate' | 'approved' | 'rejected' | 'superseded'

const SCOPES: KnowledgeScope[] = ['personal', 'project']
const TYPES: MemoryType[] = ['decision', 'lesson', 'pattern', 'constraint', 'assumption']
const STATUSES: ProposalStatus[] = ['candidate', 'approved', 'rejected', 'superseded']

export class CreateKnowledgeProposalDto {
  @ApiProperty({ enum: SCOPES })
  @IsIn(SCOPES)
  scopeType!: KnowledgeScope

  @ApiPropertyOptional({ description: 'Required when scopeType=project' })
  @IsOptional()
  @IsString()
  projectId?: string

  @ApiProperty({ description: 'Stable identity across revisions, e.g. adr/cache-policy' })
  @IsString()
  @IsNotEmpty()
  logicalKey!: string

  /**
   * Obrigatória: é ela que torna a retentativa um replay em vez de uma captura nova.
   *
   * Não há default gerado pelo servidor de propósito. Um UUID no lugar da chave ausente
   * faria "o produtor esqueceu a chave" parecer sucesso, e cada retentativa viraria uma
   * proposta a mais — o defeito exato que este campo existe para impedir, só que calado.
   */
  @ApiProperty({ description: 'Producer-chosen retry key, unique inside the authenticated namespace' })
  @IsString()
  @IsNotEmpty()
  idempotencyKey!: string

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  content!: string

  @ApiProperty({ enum: TYPES })
  @IsIn(TYPES)
  knowledgeType!: MemoryType

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  sourceType!: string

  @ApiProperty({ description: 'Stable source identity; dedupe never relies on content alone' })
  @IsString()
  @IsNotEmpty()
  sourceIdentity!: string

  @ApiPropertyOptional({ description: 'Immutable raw evidence; defaults to content' })
  @IsOptional()
  @IsString()
  sourceContent?: string

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  producer!: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  producerVersion?: string

  @ApiPropertyOptional({ default: 'internal' })
  @IsOptional()
  @IsString()
  sensitivity?: string

  @ApiPropertyOptional({ default: 'indefinite' })
  @IsOptional()
  @IsString()
  retentionPolicy?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  retainUntil?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  validFrom?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  validUntil?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>
}

export class KnowledgeDecisionDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  reason?: string
}

export class ListKnowledgeProposalDto {
  @ApiPropertyOptional({ enum: SCOPES })
  @IsOptional()
  @IsIn(SCOPES)
  scopeType?: KnowledgeScope

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  projectId?: string

  @ApiPropertyOptional({ enum: STATUSES })
  @IsOptional()
  @IsIn(STATUSES)
  status?: ProposalStatus
}
