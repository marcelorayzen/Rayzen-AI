import { AccessLevel, CatalogSource, RawCatalogAsset, RawLineageEdge } from './catalog-adapter.types'

// Contrato que qualquer catálogo fonte precisa implementar. Fase 1 traz o
// OpenMetadataAdapter; a Fase 6 do blueprint prova a abstração com um segundo
// adapter (Unity Catalog ou Dataplex) contra este mesmo contrato.
export interface CatalogAdapter {
  readonly source: CatalogSource

  listAssets(): Promise<RawCatalogAsset[]>
  getLineage(externalId: string): Promise<RawLineageEdge[]>

  // Maior risco em aberto do blueprint (ver BLUEPRINT.md, seção "Riscos"):
  // depende de mapear o usuário do Catalog Guardian pro RBAC real do catálogo
  // fonte. Sem esse mapeamento fechado, o PermissionGuardService (Fase 2) não
  // tem o que verificar.
  getUserAccessLevel(userId: string, externalId: string): Promise<AccessLevel>
}

export const CATALOG_ADAPTER = Symbol('CATALOG_ADAPTER')
