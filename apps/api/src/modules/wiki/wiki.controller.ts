import { Controller, Post, Get, Put, Delete, Body, Param, Query } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { IsString, IsOptional, IsIn } from 'class-validator'
import { WikiService } from './wiki.service'

class IndexDto {
  @IsIn(['url', 'text'])
  type!: 'url' | 'text'

  @IsString()
  source!: string

  @IsOptional()
  @IsString()
  projectId?: string
}

class UpdateDto {
  @IsString()
  contentMd!: string
}

@ApiTags('wiki')
@Controller('wiki')
export class WikiController {
  constructor(private readonly svc: WikiService) {}

  @Post('index')
  index(@Body() dto: IndexDto, @Query('force') force?: string) {
    return this.svc.index(dto, force === 'true')
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
