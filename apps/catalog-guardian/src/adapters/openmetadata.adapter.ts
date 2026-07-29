import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { CatalogAdapter } from './catalog-adapter.interface'
import { AccessLevel, RawCatalogAsset, RawGlossaryTerm, RawLineageEdge } from './catalog-adapter.types'

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

// Item 5 do roadmap — identidade real via Role/Policy do OMD (ver
// getUserAccessLevel abaixo). Shape confirmado empiricamente contra o
// sandbox real (mesmo princípio dos outros itens): rule.condition é uma
// string de expressão (ex. "matchAnyTag('PII.Sensitive')") que o OMD avalia
// server-side via SpEL — este adapter NÃO reimplementa um parser genérico,
// só reconhece o subconjunto usado pelas policies deste app (ver
// evaluateCondition).
interface OmRule {
  name: string
  resources?: string[]
  operations?: string[]
  effect: 'allow' | 'deny'
  condition?: string
}

interface OmPolicy {
  rules?: OmRule[]
}

interface OmRole {
  name: string
  policies?: OmEntityRef[]
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

interface OmGlossaryTerm {
  name: string
  fullyQualifiedName: string
  displayName?: string
  description?: string
}

interface OmGlossaryTermListResponse {
  data: OmGlossaryTerm[]
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

  // Não filtra por glossário específico (nenhum nome hardcoded) — lista todos
  // os termos de todos os glossários da instância, mesmo padrão de listAssets()
  // não assumir um service/database/schema fixo. Um cliente real pode ter
  // vários glossários; o Catalog Guardian não deveria conhecer o nome de
  // nenhum deles de antemão.
  async listGlossaryTerms(): Promise<RawGlossaryTerm[]> {
    const terms: RawGlossaryTerm[] = []
    let after: string | undefined

    do {
      const qs = new URLSearchParams({ limit: '100', ...(after ? { after } : {}) })
      const page = await this.request<OmGlossaryTermListResponse>(`/v1/glossaryTerms?${qs}`)

      for (const term of page.data) {
        terms.push({
          externalId: term.fullyQualifiedName,
          name: term.name,
          displayName: term.displayName ?? null,
          description: term.description ?? null,
        })
      }
      after = page.paging?.after
    } while (after)

    this.logger.log(`listGlossaryTerms: ${terms.length} termo(s) de glossário sincronizado(s) do OpenMetadata`)
    return terms
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

  // Domínio é o portão PRIMÁRIO — decisão de produto confirmada após a
  // validação real: citar a existência/nome de um ativo fora do domínio do
  // usuário já conta como vazamento de permissão (mesmo padrão que NEG-002
  // já exige para dado pessoal de terceiro — nem a localização pode vazar).
  // Por isso domínio errado sempre vira 'none' independente de PII/role.
  //
  // Item 5 do roadmap — dentro do domínio certo, a clearance de PII deixou
  // de ser "tem tag PII → sempre read" e passou a depender de Role/Policy
  // reais do usuário no OMD (ver hasPiiClearance). Antes disso NENHUM
  // usuário tinha clearance de verdade, nem o steward — a "visão ampla" dele
  // vinha só de estar em todos os domínios, nunca de uma permissão elevada
  // de fato.
  async getUserAccessLevel(userId: string, externalId: string): Promise<AccessLevel> {
    // Bug real pré-existente encontrado na validação empírica do item 5:
    // faltava `columns` aqui — PII marcado só na coluna (ex. clientes.cpf,
    // sem tag no nível da tabela) nunca era detectado, e o guard liberava
    // 'full' pra qualquer usuário em qualquer ativo PII-por-coluna,
    // independente de domínio ou role. listAssets()/toRawAsset() já pediam
    // `columns` corretamente — só este método vivia com o fetch incompleto.
    const table = await this.request<OmTable>(
      `/v1/tables/name/${encodeURIComponent(externalId)}?fields=owners,tags,domains,columns`,
    )
    const tagFQNs = [
      ...(table.tags ?? []),
      ...(table.columns ?? []).flatMap((c) => c.tags ?? []),
    ].map((t) => t.tagFQN)
    const isPII = tagFQNs.includes(PII_SENSITIVE_TAG)
    const assetDomain = domainSlug(table.domains?.[0]?.name)

    const user = await this.request<{ domains?: OmEntityRef[]; roles?: OmEntityRef[] }>(
      `/v1/users/name/${encodeURIComponent(userId)}?fields=domains,roles`,
    ).catch(() => ({ domains: [] as OmEntityRef[], roles: [] as OmEntityRef[] }))
    const userDomains = new Set((user.domains ?? []).map((d) => domainSlug(d.name)).filter(Boolean))

    const sameDomain = assetDomain ? userDomains.has(assetDomain) : true
    if (!sameDomain) return 'none'

    if (!isPII) return 'full'
    return (await this.hasPiiClearance(user.roles ?? [], tagFQNs)) ? 'full' : 'read'
  }

  // Só resolve roles atribuídas DIRETAMENTE ao usuário — roles herdadas via
  // team.defaultRoles ficam fora de propósito (nenhum persona do golden
  // dataset depende disso hoje; ver README § Roadmap item 5). Só é chamada
  // quando o ativo já é PII, então não adiciona custo de chamada nenhum
  // para o caso comum (ativo não-PII).
  private async hasPiiClearance(roles: OmEntityRef[], assetTagFQNs: string[]): Promise<boolean> {
    for (const role of roles) {
      const fullRole = await this.request<OmRole>(
        `/v1/roles/name/${encodeURIComponent(role.name)}?fields=policies`,
      ).catch(() => null)
      for (const policyRef of fullRole?.policies ?? []) {
        const policy = await this.request<OmPolicy>(
          `/v1/policies/name/${encodeURIComponent(policyRef.name)}?fields=rules`,
        ).catch(() => null)
        const grants = (policy?.rules ?? []).some(
          (rule) =>
            rule.effect === 'allow'
            && (rule.operations ?? []).includes('ViewAll')
            && this.evaluateCondition(rule.condition, assetTagFQNs),
        )
        if (grants) return true
      }
    }
    return false
  }

  // Deliberadamente NÃO é um parser genérico de SpEL — reconhece só o
  // subconjunto de condition string que as policies deste app usam:
  // ausência de condition (sempre concede) e `matchAnyTag('X')`. Qualquer
  // outra sintaxe é fail-closed (nunca concede clearance), com log — regra
  // igual ao resto do app: condição não reconhecida nunca vira acesso maior.
  private evaluateCondition(condition: string | undefined, assetTagFQNs: string[]): boolean {
    if (!condition) return true
    const match = condition.match(/^matchAnyTag\(\s*'([^']+)'\s*\)$/)
    if (match) return assetTagFQNs.includes(match[1])
    this.logger.warn(`evaluateCondition: condition não reconhecida, tratando como não-concedida: ${condition}`)
    return false
  }

  // Sem guarda de permissão de propósito — ver interface. Confirmado
  // empiricamente: GET /v1/domains/name/{name}?fields=owners devolve
  // `owners: EntityRef[]` no mesmo formato de tabelas.
  async getDomainOwner(domain: string): Promise<{ owner: string | null }> {
    const result = await this.request<{ owners?: OmEntityRef[] }>(
      `/v1/domains/name/${encodeURIComponent(domain)}?fields=owners`,
    ).catch(() => ({ owners: [] as OmEntityRef[] }))
    return { owner: result.owners?.[0]?.displayName ?? result.owners?.[0]?.name ?? null }
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
