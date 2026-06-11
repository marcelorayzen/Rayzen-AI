import { Controller, Post, Get, Put, Delete, Body, Param, Query } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { IsString, IsOptional, IsIn, IsArray } from 'class-validator'
import { WikiService, type LearningType } from './wiki.service'

const LEARNING_TYPES: LearningType[] = ['runbook', 'troubleshooting', 'decision', 'pattern', 'gotcha']

class IndexDto {
  @IsIn(['url', 'text'])
  type!: 'url' | 'text'

  @IsString()
  source!: string

  @IsOptional()
  @IsString()
  projectId?: string
}

class CreateDto {
  @IsString()
  slug!: string

  @IsString()
  title!: string

  @IsString()
  contentMd!: string
}

class UpdateDto {
  @IsString()
  contentMd!: string
}

class CaptureLearningDto {
  @IsString()
  title!: string

  @IsString()
  problem!: string

  @IsString()
  solution!: string

  @IsOptional()
  @IsIn(LEARNING_TYPES)
  type?: LearningType

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[]

  @IsOptional()
  @IsString()
  projectId?: string
}

@ApiTags('wiki')
@Controller('wiki')
export class WikiController {
  constructor(private readonly svc: WikiService) {}

  @Post('index')
  index(@Body() dto: IndexDto, @Query('force') force?: string) {
    return this.svc.index(dto, force === 'true')
  }

  @Post()
  create(@Body() dto: CreateDto) {
    return this.svc.create(dto.slug, dto.title, dto.contentMd)
  }

  // Write-back loop: Claude captura um aprendizado resolvido (runbook/troubleshooting/…).
  @Post('learning')
  captureLearning(@Body() dto: CaptureLearningDto) {
    return this.svc.captureLearning(dto)
  }

  @Get()
  list() {
    return this.svc.list()
  }

  @Get(':slug')
  getBySlug(@Param('slug') slug: string) {
    return this.svc.getBySlug(slug)
  }

  @Put(':slug')
  update(@Param('slug') slug: string, @Body() dto: UpdateDto) {
    return this.svc.update(slug, dto.contentMd)
  }

  @Delete(':slug')
  delete(@Param('slug') slug: string) {
    return this.svc.delete(slug)
  }

  @Get(':slug/versions')
  versions(@Param('slug') slug: string) {
    return this.svc.listVersions(slug)
  }

  @Get(':slug/sources')
  sources(@Param('slug') slug: string) {
    return this.svc.listSources(slug)
  }
}
