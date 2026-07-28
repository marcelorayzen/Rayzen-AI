// Tipos do contrato de adapter — ver catalog-adapter.interface.ts.
// Mantidos deliberadamente pequenos: cada catálogo fonte (OpenMetadata,
// Dataplex, Unity Catalog) tem um modelo de dados bem mais rico do que isto;
// o adapter é responsável por reduzir ao subconjunto que o Catalog Guardian usa.

export type CatalogSource = 'openmetadata' | 'dataplex' | 'unity_catalog'

export type AccessLevel = 'none' | 'read' | 'full'

export interface RawCatalogAsset {
  externalId: string // fully qualified name (ou equivalente) no catálogo fonte
  name: string
  description?: string | null
  owner?: string | null
  domain?: string | null
  sensitivity?: 'public' | 'internal' | 'confidential' | 'restricted'
  containsPII?: boolean
  piiFields?: string[]
  tags?: string[]
}

export interface RawLineageEdge {
  sourceExternalId: string
  targetExternalId: string
  transform?: string | null
}
