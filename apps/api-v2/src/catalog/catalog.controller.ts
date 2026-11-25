import { Controller, Get, Put, Delete, Param, Body } from '@nestjs/common'
import { ApiTags, ApiOperation } from '@nestjs/swagger'
import { IsOptional, IsString, IsArray, IsNumber, IsObject } from 'class-validator'
import { CatalogService, UpsertCatalogDto } from './catalog.service'

class UpsertCatalogBody implements UpsertCatalogDto {
  @IsOptional() @IsString()  owner?:       string
  @IsOptional() @IsString()  provenance?:  string
  @IsOptional() @IsArray()   tags?:        string[]
  @IsOptional() @IsNumber()  healthScore?: number | null
  @IsOptional() @IsObject()  metadata?:    Record<string, unknown>
  @IsOptional() @IsString()  archivedAt?:  string | null
}

@ApiTags('catalog')
@Controller('catalog')
export class CatalogController {
  constructor(private readonly svc: CatalogService) {}

  @Get()
  @ApiOperation({ summary: 'Lista todos os projetos V1 enriquecidos com metadados do catálogo' })
  list() {
    return this.svc.list()
  }

  @Put(':v1ProjectId')
  @ApiOperation({ summary: 'Upsert metadados de catálogo para um projeto' })
  upsert(@Param('v1ProjectId') id: string, @Body() dto: UpsertCatalogBody) {
    return this.svc.upsert(id, dto)
  }

  @Delete(':v1ProjectId')
  @ApiOperation({ summary: 'Remove entrada de catálogo (não apaga o projeto V1)' })
  remove(@Param('v1ProjectId') id: string) {
    return this.svc.remove(id)
  }
}
