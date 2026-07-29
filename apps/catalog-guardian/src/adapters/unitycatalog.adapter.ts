import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { CatalogAdapter } from './catalog-adapter.interface'
import { AccessLevel, RawCatalogAsset, RawGlossaryTerm, RawLineageEdge } from './catalog-adapter.types'

// Fase 6 do roadmap — prova que CatalogAdapter realmente abstrai contra um
// catálogo fonte com modelo de dados/permissão bem diferente do OMD (namespace
// de 3 níveis, grant direto principal→privilege em vez de Role→Policy→Rule).
// Ver README.md § Roadmap Fase 6 para as 2 limitações reais da OSS documentadas
// abaixo (lineage e glossário) — não são workarounds, são gaps genuínos do
// produto nesta versão.

interface UcCatalog {
  name: string
  owner?: string | null
  properties?: Record<string, string>
}

interface UcCatalogListResponse {
  catalogs?: UcCatalog[]
  next_page_token?: string
}

interface UcSchema {
  name: string
  catalog_name: string
}

interface UcSchemaListResponse {
  schemas?: UcSchema[]
  next_page_token?: string
}

interface UcColumn {
  name: string
  properties?: Record<string, string>
}

interface UcTable {
  name: string
  catalog_name: string
  schema_name: string
  comment?: string
  owner?: string | null
  properties?: Record<string, string>
  columns?: UcColumn[]
}

interface UcTableListResponse {
  tables?: UcTable[]
  next_page_token?: string
}

// Confirmado via docs oficiais (unitycatalog.io) na pesquisa desta fase — não
// contra sandbox real ainda (shape final se confirma no smoke test, mesmo
// método já usado pro OMD: implementar pela doc, corrigir o que a validação
// ao vivo mostrar diferente).
interface UcPrivilegeAssignment {
  principal: string
  privileges: string[]
}

interface UcPermissionsResponse {
  privilege_assignments?: UcPrivilegeAssignment[]
}

const PII_PROPERTY_KEY = 'pii'

@Injectable()
export class UnityCatalogAdapter implements CatalogAdapter {
  readonly source = 'unity_catalog' as const
  private readonly logger = new Logger(UnityCatalogAdapter.name)
  private readonly baseUrl: string
  private readonly token: string

  constructor(private readonly config: ConfigService) {
    this.baseUrl = this.config.get<string>('UNITYCATALOG_URL', 'http://localhost:8080/api/2.1/unity-catalog')
    this.token = this.config.get<string>('UNITYCATALOG_TOKEN', '')
  }

  private async request<T>(path: string): Promise<T> {
    const headers: Record<string, string> = {}
    if (this.token) headers.Authorization = `Bearer ${this.token}`
    const res = await fetch(`${this.baseUrl}${path}`, { headers })
    if (!res.ok) {
      throw new Error(`Unity Catalog API ${path} → HTTP ${res.status}: ${await res.text()}`)
    }
    return res.json() as Promise<T>
  }

  // Sem "Domains" nativos como no OMD — o catalog UC é o nível de granularidade
  // mais próximo (e já carrega `owner`, cobrindo getDomainOwner() de graça).
  // Decisão de mapeamento documentada no README, não um detalhe escondido.
  async listAssets(): Promise<RawCatalogAsset[]> {
    const assets: RawCatalogAsset[] = []
    let catalogPageToken: string | undefined

    do {
      const catalogQs = new URLSearchParams(catalogPageToken ? { page_token: catalogPageToken } : {})
      const catalogPage = await this.request<UcCatalogListResponse>(`/catalogs?${catalogQs}`)

      for (const catalog of catalogPage.catalogs ?? []) {
        let schemaPageToken: string | undefined
        do {
          const schemaQs = new URLSearchParams({
            catalog_name: catalog.name,
            ...(schemaPageToken ? { page_token: schemaPageToken } : {}),
          })
          const schemaPage = await this.request<UcSchemaListResponse>(`/schemas?${schemaQs}`)

          for (const schema of schemaPage.schemas ?? []) {
            let tablePageToken: string | undefined
            do {
              const tableQs = new URLSearchParams({
                catalog_name: catalog.name,
                schema_name: schema.name,
                ...(tablePageToken ? { page_token: tablePageToken } : {}),
              })
              const tablePage = await this.request<UcTableListResponse>(`/tables?${tableQs}`)

              for (const table of tablePage.tables ?? []) {
                assets.push(this.toRawAsset(table, catalog))
              }
              tablePageToken = tablePage.next_page_token
            } while (tablePageToken)
          }
          schemaPageToken = schemaPage.next_page_token
        } while (schemaPageToken)
      }
      catalogPageToken = catalogPage.next_page_token
    } while (catalogPageToken)

    this.logger.log(`listAssets: ${assets.length} tabela(s) sincronizada(s) do Unity Catalog`)
    return assets
  }

  // Limitação real e documentada da versão OSS do Unity Catalog — não há
  // suporte a lineage (feature request em aberto, issue #137 do repo
  // unitycatalog/unitycatalog). SyncService já tolera getLineage() vazio por
  // asset (mesmo tratamento usado quando o OMD falha numa chamada pontual).
  async getLineage(_externalId: string): Promise<RawLineageEdge[]> {
    return []
  }

  // Unity Catalog não tem conceito de glossário de negócio equivalente ao do
  // OMD — nenhuma sigla/termo é resolvida por este adapter. Gap real do
  // catálogo fonte, não um TODO nosso.
  async listGlossaryTerms(): Promise<RawGlossaryTerm[]> {
    return []
  }

  // Domínio (= catalog UC) continua o portão PRIMÁRIO, mesmo princípio do
  // OpenMetadataAdapter: sem NENHUM privilege no catalog/schema/table →
  // 'none' direto, PII nunca é sequer considerado. Mais simples que o
  // Role→Policy→Rule do OMD porque o próprio modelo de permissão da UC já é
  // mais simples (grant direto principal→privilege, com herança catalog →
  // schema → table) — não é uma versão incompleta do mesmo conceito, é o
  // conceito real deste catálogo fonte.
  async getUserAccessLevel(userId: string, externalId: string): Promise<AccessLevel> {
    const [catalogName, schemaName, tableName] = externalId.split('.')
    const table = await this.request<UcTable>(
      `/tables/${encodeURIComponent(externalId)}`,
    )
    const isPII = this.isPii(table)

    const hasPrivilege = await this.hasSelectPrivilege(userId, [
      { type: 'table', fullName: externalId },
      { type: 'schema', fullName: `${catalogName}.${schemaName}` },
      { type: 'catalog', fullName: catalogName },
    ])
    if (!hasPrivilege) return 'none'

    return isPII ? 'read' : 'full'
  }

  // Checa table → schema → catalog nessa ordem (herança "pra baixo" da UC:
  // um grant no catalog vale pra tudo dentro dele) — para no primeiro nível
  // onde o principal aparece com SELECT, sem falhar a chamada inteira se um
  // nível não tiver nenhum assignment (securable sem grant nenhum ainda).
  private async hasSelectPrivilege(
    userId: string,
    securables: Array<{ type: string; fullName: string }>,
  ): Promise<boolean> {
    for (const securable of securables) {
      const perms = await this.request<UcPermissionsResponse>(
        `/permissions/${securable.type}/${encodeURIComponent(securable.fullName)}`,
      ).catch(() => ({ privilege_assignments: [] as UcPrivilegeAssignment[] }))
      const assignment = (perms.privilege_assignments ?? []).find((a) => a.principal === userId)
      if (assignment?.privileges.includes('SELECT')) return true
    }
    return false
  }

  private isPii(table: UcTable): boolean {
    if (table.properties?.[PII_PROPERTY_KEY] === 'true') return true
    return (table.columns ?? []).some((c) => c.properties?.[PII_PROPERTY_KEY] === 'true')
  }

  async getDomainOwner(domain: string): Promise<{ owner: string | null }> {
    const catalog = await this.request<UcCatalog>(`/catalogs/${encodeURIComponent(domain)}`).catch(
      () => ({ owner: null }) as UcCatalog,
    )
    return { owner: catalog.owner ?? null }
  }

  private toRawAsset(table: UcTable, catalog: UcCatalog): RawCatalogAsset {
    const containsPII = this.isPii(table)
    return {
      externalId: `${table.catalog_name}.${table.schema_name}.${table.name}`,
      name: table.name,
      description: table.comment ?? null,
      owner: table.owner ?? null,
      domain: catalog.name,
      sensitivity: containsPII ? 'restricted' : 'internal',
      containsPII,
      piiFields: (table.columns ?? [])
        .filter((c) => c.properties?.[PII_PROPERTY_KEY] === 'true')
        .map((c) => c.name),
      tags: [],
    }
  }
}
