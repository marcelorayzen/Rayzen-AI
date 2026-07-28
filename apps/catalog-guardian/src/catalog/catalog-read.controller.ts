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

  // Termos de glossário citáveis por QueryService.askOwnership()/ask() —
  // sem domínio de propósito (ver CatalogGlossaryTerm no schema.prisma).
  // avaliador.py precisa disto pra não marcar citação de termo como
  // "ativo inexistente" (alucinação).
  @Get('glossary-terms')
  async listGlossaryTerms() {
    const terms = await this.prisma.catalogGlossaryTerm.findMany({
      select: { name: true, displayName: true, externalId: true },
    })
    return terms
  }
}
