import { Controller, Get } from '@nestjs/common'
import { PrismaService } from '../core/prisma.service'

// Endpoint de leitura simples pro golden-dataset/avaliador.py implementar
// ativos_existentes() e dominios_do_ativo() contra o catálogo sincronizado
// de verdade, em vez de mockar. Ver golden-dataset/README.md.
@Controller('catalog')
export class CatalogReadController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('assets')
  async listAssets() {
    const assets = await this.prisma.catalogAsset.findMany({
      select: { name: true, externalId: true, domain: true, sensitivity: true, containsPII: true },
    })
    return assets
  }
}
