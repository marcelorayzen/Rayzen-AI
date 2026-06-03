import { Controller, Get, Post, Body, Param, Query, UseGuards, HttpCode } from '@nestjs/common'
import { ApiTags, ApiBearerAuth, ApiQuery } from '@nestjs/swagger'
import { IsString, IsNotEmpty, IsOptional, IsIn } from 'class-validator'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { LineageService, LineageRelation, LINEAGE_RELATIONS } from './lineage.service'
import { JwtAuthGuard } from '../core/auth.guard'

class LinkDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  projectId!: string

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  fromId!: string

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  toId!: string

  @ApiProperty({ enum: LINEAGE_RELATIONS, description: 'satisfies | documented_by | implemented_by | validated_by' })
  @IsIn(LINEAGE_RELATIONS)
  relation!: LineageRelation
}

class TraceDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  nodeId!: string

  @ApiPropertyOptional({ enum: ['forward', 'backward', 'both'], default: 'both' })
  @IsOptional()
  @IsIn(['forward', 'backward', 'both'])
  direction?: 'forward' | 'backward' | 'both'

  @ApiPropertyOptional({ default: 6 })
  @IsOptional()
  maxDepth?: number
}

@ApiTags('lineage')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('lineage')
export class LineageController {
  constructor(private readonly lineage: LineageService) {}

  /**
   * Cria um link de lineage entre dois nós existentes.
   * Use o vocabulário canônico:
   *   requirement → satisfies     → decision
   *   decision    → documented_by → adr
   *   adr         → implemented_by → module|file
   *   module/file → validated_by  → test
   */
  @Post('link')
  link(@Body() dto: LinkDto) {
    return this.lineage.link(dto.fromId, dto.toId, dto.relation, dto.projectId)
  }

  /**
   * Trace de lineage a partir de qualquer nó.
   * Retorna subgrafo seguindo apenas relações canônicas.
   */
  @Post('trace')
  @HttpCode(200)
  trace(@Body() dto: TraceDto) {
    return this.lineage.trace(dto.nodeId, dto.direction ?? 'both', dto.maxDepth ?? 6)
  }

  /**
   * Cadeia completa de lineage a partir de um requirement.
   * Classifica nós por estágio e identifica gaps.
   */
  @Get('chain/:nodeId')
  getChain(@Param('nodeId') nodeId: string) {
    return this.lineage.getChain(nodeId)
  }

  /**
   * Relatório de cobertura de rastreabilidade do projeto.
   * Para cada requirement, verifica se há cadeia até test.
   */
  @Get('coverage/:projectId')
  coverage(@Param('projectId') projectId: string) {
    return this.lineage.coverage(projectId)
  }

  /**
   * Lista todos os links de lineage do projeto.
   */
  @Get('links/:projectId')
  listLinks(@Param('projectId') projectId: string) {
    return this.lineage.listLinks(projectId)
  }
}
