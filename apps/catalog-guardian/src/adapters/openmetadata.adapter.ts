import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { CatalogAdapter } from './catalog-adapter.interface'
import { AccessLevel, RawCatalogAsset, RawLineageEdge } from './catalog-adapter.types'

interface OmEntityRef {
  id: string
  type: string
  name: string
  displayName?: string
  fullyQualifiedName?: string
}

interface OmTagLabel {
  tagFQN: string
}

interface OmColumn {
  name: string
  tags?: OmTagLabel[]
}

interface OmTable {
  id: string
  name: string
  fullyQualifiedName: string
  description?: string
  // Confirmado empiricamente contra OMD 1.9.17 (sandbox real, não documentação):
  // são arrays (owners/domains), não os singulares owner/domain que uma leitura
  // apressada da doc mais antiga sugeriria.
  owners?: OmEntityRef[]
  domains?: OmEntityRef[]
  tags?: OmTagLabel[]
  columns?: OmColumn[]
}

interface OmTableListResponse {
  data: OmTable[]
  paging: { after?: string; before?: string }
}

// Confirmado empiricamente contra OMD 1.9.17: fromEntity/toEntity no GET de
// lineage são ids em string puros (não `{id, type}` como no PUT de criação),
// e vêm em dois arrays separados (upstream/downstream), não um `edges` único.
interface OmLineageEdge {
  fromEntity: string
  toEntity: string
}

interface OmLineageResponse {
  entity: OmEntityRef
  nodes: OmEntityRef[]
  upstreamEdges: OmLineageEdge[]
  downstreamEdges: OmLineageEdge[]
}

const PII_SENSITIVE_TAG = 'PII.Sensitive'

// Domínios de negócio (sensibilidade não-PII) que a organização usa hoje.
// Fase 1 assume que o time do catálogo já nomeia domínios do OMD ("Domains"
// nativos do produto) com os mesmos nomes usados no golden-dataset.yaml —
// vendas/marketing/produto/financeiro/rh.
//
// Usa `name` (slug estável, ex. "rh"), NUNCA `displayName` (rótulo livre,
// ex. "Recursos Humanos") — confirmado empiricamente contra o sandbox real:
// comparar por displayName quebrou o próprio domínio "rh" (usuário cadastrado
// com domains:["rh"] não batia com a tabela cujo domains[0].displayName era
// "Recursos Humanos"), restringindo por engano o acesso de um usuário aos
// dados do seu próprio domínio.
function domainSlug(name: string | undefined): string | null {
  if (!name) return null
  return name.trim().toLowerCase()
}

@Injectable()
export class OpenMetadataAdapter implements CatalogAdapter {
  readonly source = 'openmetadata' as const
  private readonly logger = new Logger(OpenMetadataAdapter.name)
  private readonly baseUrl: string
  private readonly token: string

  constructor(private readonly config: ConfigService) {
    this.baseUrl = this.config.get<string>('OPENMETADATA_URL', 'http://localhost:8585/api')
    this.token = this.config.get<string>('OPENMETADATA_TOKEN', '')
    if (!this.token) {
      this.logger.warn('OPENMETADATA_TOKEN não configurado — chamadas ao OMD vão falhar com 401')
    }
  }

  private async request<T>(path: string): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      headers: { Authorization: `Bearer ${this.token}` },
    })
    if (!res.ok) {
      throw new Error(`OpenMetadata API ${path} → HTTP ${res.status}: ${await res.text()}`)
    }
    return res.json() as Promise<T>
  }

  async listAssets(): Promise<RawCatalogAsset[]> {
    const assets: RawCatalogAsset[] = []
    let after: string | undefined

    do {
      const qs = new URLSearchParams({
        fields: 'owners,tags,domains,description,columns',
        limit: '100',
        ...(after ? { after } : {}),
      })
      const page = await this.request<OmTableListResponse>(`/v1/tables?${qs}`)

      for (const table of page.data) {
        assets.push(this.toRawAsset(table))
      }
      after = page.paging?.after
    } while (after)

    this.logger.log(`listAssets: ${assets.length} tabela(s) sincronizada(s) do OpenMetadata`)
    return assets
  }

  async getLineage(externalId: string): Promise<RawLineageEdge[]> {
    const qs = new URLSearchParams({ upstreamDepth: '1', downstreamDepth: '1' })
    const lineage = await this.request<OmLineageResponse>(
      `/v1/lineage/table/name/${encodeURIComponent(externalId)}?${qs}`,
    )

    // `nodes` só traz as entidades DO OUTRO LADO da relação — a própria
    // entidade consultada (lineage.entity) não aparece lá e precisa entrar
    // no mapa manualmente, senão toda edge que a referencia (como toEntity
    // de um upstream, por ex.) é descartada por "destino desconhecido".
    const byId = new Map(
      [lineage.entity, ...lineage.nodes].map((n) => [n.id, n.fullyQualifiedName ?? n.name]),
    )
    const allEdges = [...(lineage.upstreamEdges ?? []), ...(lineage.downstreamEdges ?? [])]
    return allEdges
      .map((edge) => ({
        sourceExternalId: byId.get(edge.fromEntity),
        targetExternalId: byId.get(edge.toEntity),
      }))
      .filter((e): e is { sourceExternalId: string; targetExternalId: string } => !!e.sourceExternalId && !!e.targetExternalId)
  }

  // Implementação Fase 1 — heurística por domínio, não avaliação completa da
  // policy engine do OMD (Teams/Roles/Policies/Personas). É o maior risco em
  // aberto do blueprint: fechar isto de verdade exige mapear o usuário do
  // Catalog Guardian para uma Team/Role real do OMD e avaliar a política
  // nativa dele, não só comparar nome de domínio. Ver BLUEPRINT.md § Riscos.
  //
  // Domínio é o portão PRIMÁRIO — decisão de produto confirmada após a
  // validação real: citar a existência/nome de um ativo fora do domínio do
  // usuário já conta como vazamento de permissão (mesmo padrão que NEG-002
  // já exige para dado pessoal de terceiro — nem a localização pode vazar).
  // Por isso domínio errado sempre vira 'none' independente de PII; dentro
  // do domínio certo, PII só refina pra 'read' (conteúdo visível, colunas
  // sensíveis redigidas) em vez de excluir o ativo inteiro.
  async getUserAccessLevel(userId: string, externalId: string): Promise<AccessLevel> {
    const table = await this.request<OmTable>(
      `/v1/tables/name/${encodeURIComponent(externalId)}?fields=owners,tags,domains`,
    )
    const isPII = (table.tags ?? []).some((t) => t.tagFQN === PII_SENSITIVE_TAG)
      || (table.columns ?? []).some((c) => (c.tags ?? []).some((t) => t.tagFQN === PII_SENSITIVE_TAG))
    const assetDomain = domainSlug(table.domains?.[0]?.name)

    const user = await this.request<{ domains?: OmEntityRef[] }>(
      `/v1/users/name/${encodeURIComponent(userId)}?fields=domains`,
    ).catch(() => ({ domains: [] as OmEntityRef[] }))
    const userDomains = new Set((user.domains ?? []).map((d) => domainSlug(d.name)).filter(Boolean))

    const sameDomain = assetDomain ? userDomains.has(assetDomain) : true
    if (!sameDomain) return 'none'

    return isPII ? 'read' : 'full' // metadado de PII: nunca 'full' (valor bruto nunca é servido por este app)
  }

  private toRawAsset(table: OmTable): RawCatalogAsset {
    const columnTags = (table.columns ?? []).flatMap((c) => c.tags ?? [])
    const allTags = [...(table.tags ?? []), ...columnTags]
    const containsPII = allTags.some((t) => t.tagFQN === PII_SENSITIVE_TAG)

    return {
      externalId: table.fullyQualifiedName,
      name: table.name,
      description: table.description ?? null,
      owner: table.owners?.[0]?.displayName ?? table.owners?.[0]?.name ?? null,
      domain: domainSlug(table.domains?.[0]?.name),
      sensitivity: containsPII ? 'restricted' : 'internal',
      containsPII,
      piiFields: (table.columns ?? [])
        .filter((c) => (c.tags ?? []).some((t) => t.tagFQN === PII_SENSITIVE_TAG))
        .map((c) => c.name),
      tags: allTags.map((t) => t.tagFQN),
    }
  }
}
