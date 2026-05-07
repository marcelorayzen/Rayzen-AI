import { Controller, Get, Post, Patch, Delete, Body, Param, Query } from '@nestjs/common'
import { ApiTags, ApiOperation } from '@nestjs/swagger'
import { DataCatalogService, CreateDataAssetDto } from './data-catalog.service'

@ApiTags('data-catalog')
@Controller('data-catalog')
export class DataCatalogController {
  constructor(private readonly catalog: DataCatalogService) {}

  @Post('assets')
  @ApiOperation({ summary: 'Criar data asset no catálogo' })
  createAsset(@Body() dto: CreateDataAssetDto) {
    return this.catalog.createAsset(dto)
  }

  @Get('assets')
  @ApiOperation({ summary: 'Listar assets — filtros: project_id, type, sensitivity, pii' })
  listAssets(
    @Query('project_id') projectId?: string,
    @Query('type') type?: string,
    @Query('sensitivity') sensitivity?: string,
    @Query('pii') pii?: string,
  ) {
    return this.catalog.listAssets(projectId, {
      type,
      sensitivity,
      containsPII: pii !== undefined ? pii === 'true' : undefined,
    })
  }

  @Get('assets/:id')
  @ApiOperation({ summary: 'Buscar asset por ID' })
  getAsset(@Param('id') id: string) {
    return this.catalog.getAsset(id)
  }

  @Patch('assets/:id')
  @ApiOperation({ summary: 'Atualizar data asset' })
  updateAsset(@Param('id') id: string, @Body() dto: Partial<CreateDataAssetDto>) {
    return this.catalog.updateAsset(id, dto)
  }

  @Delete('assets/:id')
  @ApiOperation({ summary: 'Remover asset do catálogo' })
  deleteAsset(@Param('id') id: string) {
    return this.catalog.deleteAsset(id)
  }

  @Post('lineage')
  @ApiOperation({ summary: 'Registrar relação de linhagem: source → target' })
  addLineage(@Body() body: { sourceId: string; targetId: string; transformation?: string }) {
    return this.catalog.addLineageEdge(body.sourceId, body.targetId, body.transformation)
  }

  @Get('lineage/:assetId')
  @ApiOperation({ summary: 'Ver upstream e downstream de um asset' })
  getLineage(@Param('assetId') assetId: string) {
    return this.catalog.getLineage(assetId)
  }

  @Get('lineage/impact/:assetId')
  @ApiOperation({ summary: 'Impacto cascata se o asset mudar' })
  getImpact(@Param('assetId') assetId: string) {
    return this.catalog.getImpact(assetId)
  }
}
