import {
  Controller, Get, Post, Delete,
  Param, Body, Query, UseGuards, HttpCode,
} from '@nestjs/common'
import { ApiTags, ApiBearerAuth, ApiQuery } from '@nestjs/swagger'
import { IsString, IsNotEmpty, IsOptional, IsArray, IsNumber, IsIn, IsObject } from 'class-validator'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { KnowledgeStorageService, EntityType } from './knowledge-storage.service'
import { KnowledgeQueryService } from './knowledge-query.service'
import { KnowledgeExtractorService } from './knowledge-extractor.service'
import { KnowledgeImpactService } from './knowledge-impact.service'
import { JwtAuthGuard } from '../core/auth.guard'

class AddNodeDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  projectId!: string

  @ApiProperty({ enum: ['module','rule','entity','adr','flow','file','concept'] })
  @IsIn(['module','rule','entity','adr','flow','file','concept'])
  type!: EntityType

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  label!: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>
}

class AddEdgeDto {
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

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  relation!: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  weight?: number
}

class ExtractDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  projectId!: string

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  text!: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  context?: string

  @ApiPropertyOptional({ description: 'Auto-persist extracted triplets' })
  @IsOptional()
  persist?: boolean
}

class ImpactDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  projectId!: string

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  change!: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  entities?: string[]
}

class QueryDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  projectId!: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  startLabel?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  startId?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  relations?: string[]

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  depth?: number
}

@ApiTags('knowledge')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('knowledge')
export class KnowledgeController {
  constructor(
    private readonly storage:    KnowledgeStorageService,
    private readonly queryService: KnowledgeQueryService,
    private readonly extractor:  KnowledgeExtractorService,
    private readonly impactSvc:  KnowledgeImpactService,
  ) {}

  @Post('nodes')
  addNode(@Body() dto: AddNodeDto) {
    return this.storage.upsertNode(dto)
  }

  @Get('graph/:projectId')
  getGraph(@Param('projectId') projectId: string) {
    return this.storage.getGraph(projectId)
  }

  @Get('nodes/:projectId')
  @ApiQuery({ name: 'type', required: false })
  listNodes(@Param('projectId') projectId: string, @Query('type') type?: string) {
    return this.storage.listNodes(projectId, type as EntityType | undefined)
  }

  @Get('entity/:id')
  getEntity(@Param('id') id: string) {
    return this.storage.getNode(id)
  }

  @Delete('nodes/:id')
  @HttpCode(204)
  deleteNode(@Param('id') id: string) {
    return this.storage.deleteNode(id)
  }

  @Post('edges')
  addEdge(@Body() dto: AddEdgeDto) {
    return this.storage.upsertEdge(dto)
  }

  @Post('query')
  @HttpCode(200)
  queryGraph(@Body() dto: QueryDto) {
    return this.queryService.query(dto)
  }

  @Post('extract')
  @HttpCode(200)
  async extract(@Body() dto: ExtractDto) {
    const triplets = await this.extractor.extract(dto.text, dto.context)

    if (dto.persist) {
      // Persist all extracted nodes and edges
      const nodeMap = new Map<string, string>()
      for (const t of triplets) {
        const fromNode = await this.storage.upsertNode({
          projectId: dto.projectId,
          type:      t.fromType as EntityType,
          label:     t.from,
        })
        const toNode = await this.storage.upsertNode({
          projectId: dto.projectId,
          type:      t.toType as EntityType,
          label:     t.to,
        })
        nodeMap.set(t.from, fromNode.id)
        nodeMap.set(t.to, toNode.id)
        await this.storage.upsertEdge({
          projectId: dto.projectId,
          fromId:    fromNode.id,
          toId:      toNode.id,
          relation:  t.relation,
          weight:    t.weight ?? 1.0,
        })
      }
      return { triplets, persisted: triplets.length }
    }

    return { triplets }
  }

  @Post('impact')
  @HttpCode(200)
  analyzeImpact(@Body() dto: ImpactDto) {
    return this.impactSvc.analyze(dto)
  }
}
