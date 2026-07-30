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
  // Confirmado no api/all.yaml oficial (SchemaInfo.owner) — "Username of
  // current owner of schema", exatamente o que getDomainOwner() precisa
  // agora que domain = nome do schema, não do catalog.
  owner?: string | null
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

  // Backlog "domínio=catalog" fechado: domínio deixou de ser o catalog e
  // passou a ser o nome do SCHEMA. Motivo: um catalog real do cliente pode
  // misturar vários domínios de negócio (schemas diferentes dentro do mesmo
  // catalog) — catalog = namespace/ambiente (ex. "producao"), schema = o
  // domínio de verdade (ex. "vendas", "financeiro"), exatamente a palavra
  // que extractDomainMention() casa contra a pergunta em linguagem natural
  // (ver ownership-question.util.ts). "catalog.schema" composto foi cogitado
  // e descartado: ninguém diz "vendas.public" numa frase.
  async listAssets(): Promise<RawCatalogAsset[]> {
    const assets: RawCatalogAsset[] = []

    for (const { schema } of await this.listAllSchemas()) {
      let tablePageToken: string | undefined
      do {
        const tableQs = new URLSearchParams({
          catalog_name: schema.catalog_name,
          schema_name: schema.name,
          ...(tablePageToken ? { page_token: tablePageToken } : {}),
        })
        const tablePage = await this.request<UcTableListResponse>(`/tables?${tableQs}`)

        for (const table of tablePage.tables ?? []) {
          assets.push(this.toRawAsset(table, schema))
        }
        tablePageToken = tablePage.next_page_token
      } while (tablePageToken)
    }

    this.logger.log(`listAssets: ${assets.length} tabela(s) sincronizada(s) do Unity Catalog`)
    return assets
  }

  // Compartilhado por listAssets() e listDomains() — os dois precisam
  // enumerar catalog→schema inteiro, só o que fazem com cada schema difere.
  private async listAllSchemas(): Promise<Array<{ catalog: UcCatalog; schema: UcSchema }>> {
    const result: Array<{ catalog: UcCatalog; schema: UcSchema }> = []
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

          for (const schema of schemaPage.schemas ?? []) result.push({ catalog, schema })
          schemaPageToken = schemaPage.next_page_token
        } while (schemaPageToken)
      }
      catalogPageToken = catalogPage.next_page_token
    } while (catalogPageToken)

    return result
  }

  // Backlog "KNOWN_DOMAINS hardcoded" fechado junto — nomes de schema
  // dedupados (o mesmo nome de domínio pode existir em catalogs/namespaces
  // diferentes, ex. "vendas" em "producao" e em "staging").
  async listDomains(): Promise<string[]> {
    const schemas = await this.listAllSchemas()
    return [...new Set(schemas.map(({ schema }) => schema.name))]
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

  // O gate de domínio aqui é implícito, não uma comparação explícita de
  // string como no OMD: sem NENHUM privilege no catalog/schema/table →
  // 'none' direto, PII nunca é sequer considerado. Não muda com o backlog
  // "domínio=catalog" (domain virou nome do schema, ver toRawAsset) porque
  // este método já opera direto sobre catalog/schema/table extraídos do
  // externalId, nunca sobre o campo `domain` do CatalogAsset — a herança
  // real de privilege (catalog → schema → table) da UC já cobre a mesma
  // garantia que o campo domain expressa pros outros usos (ownership etc).
  // Mais simples que o Role→Policy→Rule do OMD porque o próprio modelo de
  // permissão da UC já é mais simples (grant direto principal→privilege) —
  // não é uma versão incompleta do mesmo conceito, é o conceito real deste
  // catálogo fonte.
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

  // domain aqui é nome de SCHEMA, não de catalog — precisa descobrir em qual
  // catalog esse schema vive (schema.name não é globalmente único por
  // constrói, mas é único o bastante numa organização real; primeiro match
  // vence, mesma aposta que OMD já faz assumindo slugs de Domain únicos).
  // GET direto por full_name (catalog.schema) em vez de listar+filtrar —
  // 1 chamada por catalog candidato, para no primeiro que responder 200.
  async getDomainOwner(domain: string): Promise<{ owner: string | null }> {
    let catalogPageToken: string | undefined
    do {
      const catalogQs = new URLSearchParams(catalogPageToken ? { page_token: catalogPageToken } : {})
      const catalogPage = await this.request<UcCatalogListResponse>(`/catalogs?${catalogQs}`).catch(
        () => ({ catalogs: [] as UcCatalog[] }) as UcCatalogListResponse,
      )

      for (const catalog of catalogPage.catalogs ?? []) {
        const fullName = `${catalog.name}.${domain}`
        const schema = await this.request<UcSchema>(`/schemas/${encodeURIComponent(fullName)}`).catch(() => null)
        if (schema) return { owner: schema.owner ?? null }
      }
      catalogPageToken = catalogPage.next_page_token
    } while (catalogPageToken)

    return { owner: null }
  }

  private toRawAsset(table: UcTable, schema: UcSchema): RawCatalogAsset {
    const containsPII = this.isPii(table)
    return {
      externalId: `${table.catalog_name}.${table.schema_name}.${table.name}`,
      name: table.name,
      description: table.comment ?? null,
      owner: table.owner ?? null,
      domain: schema.name,
      sensitivity: containsPII ? 'restricted' : 'internal',
      containsPII,
      piiFields: (table.columns ?? [])
        .filter((c) => c.properties?.[PII_PROPERTY_KEY] === 'true')
        .map((c) => c.name),
      tags: [],
    }
  }
}
