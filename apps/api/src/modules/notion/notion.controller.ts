import { Controller, Get, Post, Patch, Query, Body, Param } from '@nestjs/common'
import { ApiTags, ApiOperation } from '@nestjs/swagger'
import { IsString, IsOptional, IsArray, IsNumber, Min, Max } from 'class-validator'
import { NotionService } from './notion.service'

class SearchNotionDto {
  @IsString()
  query!: string

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(20)
  limit?: number
}

class CreatePageDto {
  @IsString()
  title!: string

  @IsString()
  content!: string

  @IsOptional()
  @IsString()
  parentPageId?: string

  @IsOptional()
  @IsString()
  parentDatabaseId?: string

  @IsOptional()
  @IsArray()
  tags?: string[]
}

class AppendPageDto {
  @IsString()
  content!: string
}

class UpdateTitleDto {
  @IsString()
  title!: string
}

@ApiTags('notion')
@Controller('notion')
export class NotionController {
  constructor(private readonly svc: NotionService) {}

  @Get('search')
  @ApiOperation({ summary: 'Buscar páginas no Notion por título ou conteúdo' })
  search(@Query('q') query: string, @Query('limit') limit?: string) {
    return this.svc.search(query, limit ? parseInt(limit) : 10)
  }

  @Get('pages/:id')
  @ApiOperation({ summary: 'Ler conteúdo de uma página do Notion' })
  getPage(@Param('id') id: string) {
    return this.svc.getPage(id)
  }

  @Post('pages')
  @ApiOperation({ summary: 'Criar nova página no Notion' })
  createPage(@Body() dto: CreatePageDto) {
    return this.svc.createPage(dto)
  }

  @Post('pages/:id/append')
  @ApiOperation({ summary: 'Adicionar conteúdo ao final de uma página existente' })
  appendToPage(@Param('id') id: string, @Body() dto: AppendPageDto) {
    return this.svc.appendToPage(id, dto.content)
  }

  @Patch('pages/:id/title')
  @ApiOperation({ summary: 'Atualizar título de uma página' })
  updateTitle(@Param('id') id: string, @Body() dto: UpdateTitleDto) {
    return this.svc.updatePageTitle(id, dto.title)
  }

  @Post('sync/:projectId')
  @ApiOperation({ summary: 'Publica documentos do projeto no banco Notion vinculado (notionDatabaseId)' })
  syncProject(
    @Param('projectId') projectId: string,
    @Query('types') types?: string,
  ) {
    const docTypes = types ? types.split(',').map(t => t.trim()) : undefined
    return this.svc.syncProject(projectId, docTypes)
  }
}
