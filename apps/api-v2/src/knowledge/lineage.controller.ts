import { Controller, Get, Post, Body, Param, Query, UseGuards, HttpCode } from '@nestjs/common'
import { ApiTags, ApiBearerAuth, ApiQuery } from '@nestjs/swagger'
import { IsString, IsNotEmpty, IsOptional, IsIn, IsArray, IsBoolean, ValidateNested } from 'class-validator'
import { Type } from 'class-transformer'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { LineageService, LineageRelation, LINEAGE_RELATIONS } from './lineage.service'
import { CodeLineageService } from './code-lineage.service'
import { JwtAuthGuard } from '../core/auth.guard'

class SyncFileDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  path!: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isRoute?: boolean

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  routePrefix?: string
}

class SyncEdgeDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  from!: string

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  to!: string
}

class SyncFilesDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  projectId!: string

  @ApiProperty({ type: [SyncFileDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SyncFileDto)
  files!: SyncFileDto[]

  @ApiProperty({ type: [SyncEdgeDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SyncEdgeDto)
  edges!: SyncEdgeDto[]
}

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
  constructor(
    private readonly lineage:     LineageService,
    private readonly codeLineage: CodeLineageService,
  ) {}

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

  /**
   * Sincroniza o lineage de código real (AST, via graphify) — chamado pelo agent
   * desktop, único lugar com acesso ao graphify-out/graph.json local. Full-replace
   * dos edges 'depende_de' do projeto a cada sync.
   */
  @Post('files/sync')
  @HttpCode(200)
  syncFiles(@Body() dto: SyncFilesDto) {
    return this.codeLineage.syncFiles(dto.projectId, dto.files, dto.edges)
  }

  /**
   * Dado um arquivo, retorna tudo que seria impactado se ele mudasse — módulos e
   * rotas (NestJS controllers) que dependem dele, direta ou transitivamente.
   */
  @Get('files/impact')
  @ApiQuery({ name: 'projectId', required: true })
  @ApiQuery({ name: 'filePath', required: true })
  @ApiQuery({ name: 'maxDepth', required: false })
  fileImpact(
    @Query('projectId') projectId: string,
    @Query('filePath') filePath: string,
    @Query('maxDepth') maxDepth?: string,
  ) {
    return this.codeLineage.impactFromFile(projectId, filePath, maxDepth ? Number(maxDepth) : undefined)
  }
}
