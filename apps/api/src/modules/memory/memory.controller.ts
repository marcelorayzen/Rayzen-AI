import { Controller, Post, Get, Delete, Body, Param, Req, Query } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { SkipThrottle } from '@nestjs/throttler'
import { MemoryService } from './memory.service'
import { IsString, IsOptional } from 'class-validator'
import type { MultipartFile } from '@fastify/multipart'

class IndexDto {
  @IsString()
  content!: string

  @IsOptional()
  @IsString()
  sourcePath?: string

  @IsOptional()
  metadata?: Record<string, unknown>

  @IsOptional()
  @IsString()
  projectId?: string
}

class SearchDto {
  @IsString()
  query!: string

  @IsOptional()
  @IsString()
  sessionId?: string
}

class GithubDto {
  @IsString()
  username!: string

  @IsOptional()
  @IsString()
  token?: string

  @IsOptional()
  @IsString()
  projectId?: string
}

class UrlDto {
  @IsString()
  url!: string

  @IsOptional()
  @IsString()
  projectId?: string
}

class NotionDto {
  @IsString()
  integrationToken!: string

  @IsOptional()
  @IsString()
  rootPageId?: string

  @IsOptional()
  @IsString()
  projectId?: string
}

@ApiTags('memory')
@Controller('memory')
export class MemoryController {
  constructor(private readonly svc: MemoryService) {}

  @Post('index')
  index(@Body() dto: IndexDto) {
    return this.svc.indexDocument(dto.content, dto.sourcePath, dto.metadata, dto.projectId)
  }

  @Post('search')
  search(@Body() dto: SearchDto) {
    const sessionId = dto.sessionId ?? crypto.randomUUID()
    return this.svc.searchAndSynthesize(dto.query, sessionId)
  }

  @Get('documents')
  list(@Query('projectId') projectId?: string) {
    return this.svc.listDocuments(projectId)
  }

  @Delete('documents/:id')
  deleteDocument(@Param('id') id: string) {
    return this.svc.deleteDocument(id)
  }

  @SkipThrottle()
  @Post('index/github')
  indexGithub(@Body() dto: GithubDto) {
    return this.svc.indexGithub(dto.username, dto.token, dto.projectId)
  }

  @SkipThrottle()
  @Post('index/url')
  indexUrl(@Body() dto: UrlDto) {
    return this.svc.indexUrl(dto.url, dto.projectId)
  }

  @SkipThrottle()
  @Post('index/notion')
  indexNotion(@Body() dto: NotionDto) {
    return this.svc.indexNotion(dto.integrationToken, dto.rootPageId, dto.projectId)
  }

  @SkipThrottle()
  @Post('index/file')
  async indexFile(@Req() req: { file: () => Promise<MultipartFile | undefined> }) {
    const data = await req.file()
    if (!data) throw new Error('Nenhum arquivo enviado')

    const buffer = await data.toBuffer()
    const filename = data.filename
    const sourcePath = (data.fields['sourcePath'] as { value: string } | undefined)?.value
    const projectId = (data.fields['projectId'] as { value: string } | undefined)?.value

    return this.svc.indexFile(buffer, filename, sourcePath, projectId)
  }
}
