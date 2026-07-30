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

// Campos confirmados contra o source real do OMD (SubjectContext.TEAM_FIELDS,
// versão 1.13.2-release): defaultRoles = roles herdadas por todo membro do
// time; parents = hierarquia (um time pode ter múltiplos pais).
interface OmTeam {
  name: string
  defaultRoles?: OmEntityRef[]
  parents?: OmEntityRef[]
}

// Contexto resolvido ANTES de avaliar qualquer rule.condition — toda a parte
// assíncrona (percorrer hierarquia de times) já aconteceu, evaluateCondition
// fica síncrona e pura.
interface ConditionContext {
  tagFQNs: string[]
  userId: string
  resourceOwners: OmEntityRef[]
  userDirectTeamNames: Set<string>
  teamHierarchyNames: Set<string>
  effectiveRoleNames: Set<string>
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

interface OmDomain {
  name: string
}

interface OmDomainListResponse {
  data: OmDomain[]
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

  // Backlog "KNOWN_DOMAINS hardcoded" — substitui o const fixo que
  // extractDomainMention() usava. Usa `name` (slug estável), nunca
  // `displayName`, mesmo raciocínio de domainSlug() acima (comparar por
  // displayName já quebrou o domínio "rh" numa validação anterior).
  async listDomains(): Promise<string[]> {
    const domains: string[] = []
    let after: string | undefined

    do {
      const qs = new URLSearchParams({ limit: '100', ...(after ? { after } : {}) })
      const page = await this.request<OmDomainListResponse>(`/v1/domains?${qs}`)

      for (const domain of page.data) {
        const slug = domainSlug(domain.name)
        if (slug) domains.push(slug)
      }
      after = page.paging?.after
    } while (after)

    return domains
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

    const user = await this.request<{ domains?: OmEntityRef[]; roles?: OmEntityRef[]; teams?: OmEntityRef[] }>(
      `/v1/users/name/${encodeURIComponent(userId)}?fields=domains,roles,teams`,
    ).catch(() => ({ domains: [] as OmEntityRef[], roles: [] as OmEntityRef[], teams: [] as OmEntityRef[] }))
    const userDomains = new Set((user.domains ?? []).map((d) => domainSlug(d.name)).filter(Boolean))

    const sameDomain = assetDomain ? userDomains.has(assetDomain) : true
    if (!sameDomain) return 'none'

    if (!isPII) return 'full'

    const directTeams = user.teams ?? []
    const { inheritedRoleNames, teamHierarchyNames } = await this.resolveTeamHierarchy(directTeams)
    const directRoleNames = (user.roles ?? []).map((r) => r.name)
    const roleNamesToCheck = new Set([...directRoleNames, ...inheritedRoleNames])

    return (
      await this.hasPiiClearance(roleNamesToCheck, {
        tagFQNs,
        userId,
        resourceOwners: table.owners ?? [],
        userDirectTeamNames: new Set(directTeams.map((t) => t.name)),
        teamHierarchyNames,
        effectiveRoleNames: roleNamesToCheck,
      })
    )
      ? 'full'
      : 'read'
  }

  // Sobe a hierarquia de times do usuário (team.parents, recursivo) juntando
  // roles herdadas (team.defaultRoles) e o conjunto de nomes de times sob os
  // quais o usuário está — mesmo algoritmo do SubjectContext.hasRole()/
  // isUserUnderTeam() do OMD real (confirmado no source da versão
  // 1.13.2-release), com proteção contra ciclo via visitedTeams (por id).
  // Um único walk serve tanto pra descoberta de policy (hasAnyRole efetivo)
  // quanto pra inAnyTeam() — evita buscar cada time duas vezes.
  private async resolveTeamHierarchy(
    directTeams: OmEntityRef[],
  ): Promise<{ inheritedRoleNames: string[]; teamHierarchyNames: Set<string> }> {
    const teamHierarchyNames = new Set(directTeams.map((t) => t.name))
    const inheritedRoleNames: string[] = []
    const visitedTeamIds = new Set<string>()
    const stack = [...directTeams]

    while (stack.length) {
      const teamRef = stack.pop()!
      if (visitedTeamIds.has(teamRef.id)) continue
      visitedTeamIds.add(teamRef.id)

      const team = await this.request<OmTeam>(
        `/v1/teams/name/${encodeURIComponent(teamRef.name)}?fields=defaultRoles,parents`,
      ).catch(() => null)
      if (!team) continue

      for (const role of team.defaultRoles ?? []) inheritedRoleNames.push(role.name)
      for (const parent of team.parents ?? []) {
        teamHierarchyNames.add(parent.name)
        stack.push(parent)
      }
    }

    return { inheritedRoleNames, teamHierarchyNames }
  }

  // Item 5 original: só resolvia roles atribuídas DIRETAMENTE ao usuário.
  // Item de backlog "identidade" fechado agora: roleNamesToCheck já vem com
  // diretas + herdadas via team.defaultRoles (resolveTeamHierarchy acima) —
  // um role concedido só por membership de time (padrão comum de org real)
  // deixa de ficar invisível pra este adapter. Só é chamada quando o ativo já
  // é PII, então não adiciona custo de chamada nenhum pro caso comum.
  //
  // Item 7 (revisão pós-Fase 6): `deny` explícito vence `allow` — retorna
  // false assim que QUALQUER regra `deny` bater (nenhum role "salva" a
  // clearance depois disso), só retorna true no fim se nenhum deny bateu e
  // pelo menos um allow bateu.
  private async hasPiiClearance(roleNamesToCheck: Set<string>, ctx: ConditionContext): Promise<boolean> {
    let allowed = false
    for (const roleName of roleNamesToCheck) {
      const fullRole = await this.request<OmRole>(
        `/v1/roles/name/${encodeURIComponent(roleName)}?fields=policies`,
      ).catch(() => null)
      for (const policyRef of fullRole?.policies ?? []) {
        const policy = await this.request<OmPolicy>(
          `/v1/policies/name/${encodeURIComponent(policyRef.name)}?fields=rules`,
        ).catch(() => null)
        for (const rule of policy?.rules ?? []) {
          if (!(rule.operations ?? []).includes('ViewAll')) continue
          if (!this.evaluateCondition(rule.condition, ctx)) continue
          if (rule.effect === 'deny') return false
          allowed = true
        }
      }
    }
    return allowed
  }

  // Deliberadamente NÃO é um parser genérico de SpEL — reconhece só o
  // subconjunto de condition function que as policies deste app usam,
  // confirmado contra o source real do OMD (RuleEvaluator.java, versão
  // 1.13.2-release): ausência de condition (sempre concede), `matchAnyTag`,
  // `isOwner`, `hasAnyRole`, `inAnyTeam`, `hasDomain`. `matchTeam()` é
  // reconhecida mas fica fail-closed de propósito (ver comentário abaixo).
  // Qualquer outra sintaxe também é fail-closed — condição não reconhecida
  // nunca vira acesso maior.
  private evaluateCondition(condition: string | undefined, ctx: ConditionContext): boolean {
    if (!condition) return true

    const matchAnyTag = condition.match(/^matchAnyTag\(\s*'([^']+)'\s*\)$/)
    if (matchAnyTag) return ctx.tagFQNs.includes(matchAnyTag[1])

    if (condition === 'isOwner()') {
      // Mesma semântica do SubjectContext.isOwner() real: dono direto (owner
      // é o próprio usuário) OU dono é um time do qual o usuário é membro
      // DIRETO (sem subir hierarquia — o OMD real também não sobe aqui).
      return ctx.resourceOwners.some((owner) =>
        owner.type === 'user'
          ? owner.name === ctx.userId
          : owner.type === 'team' && ctx.userDirectTeamNames.has(owner.name),
      )
    }

    const hasAnyRole = condition.match(/^hasAnyRole\(\s*(.+)\s*\)$/)
    if (hasAnyRole) {
      return this.parseStringArgs(hasAnyRole[1]).some((name) => ctx.effectiveRoleNames.has(name))
    }

    const inAnyTeam = condition.match(/^inAnyTeam\(\s*(.+)\s*\)$/)
    if (inAnyTeam) {
      return this.parseStringArgs(inAnyTeam[1]).some((name) => ctx.teamHierarchyNames.has(name))
    }

    if (condition === 'hasDomain()') {
      // Neste ponto do fluxo (dentro de hasPiiClearance, chamado só depois
      // do gate de domínio de getUserAccessLevel já ter passado) hasDomain()
      // é sempre true por construção — se o usuário não tivesse acesso ao
      // domínio do ativo, getUserAccessLevel já teria retornado 'none' antes
      // de chegar aqui. Não reimplementa a hierarquia real de domínio do OMD
      // (domínio pai acessa sub-domínio) — o gate deste app é mais simples
      // (slug exato), gap já documentado em README § Backlog ("domínio é uma
      // simplificação").
      return true
    }

    if (condition === 'matchTeam()') {
      // Reconhecida, mas genuinamente não implementável sem modelar a qual
      // TEAM a própria policy está anexada (policyContext no OMD real) — este
      // adapter busca Role→Policy→Rule direto por nome e nunca sabe em qual
      // entidade a policy foi atribuída. Gap documentado, não bug silencioso.
      this.logger.warn(
        "evaluateCondition: 'matchTeam()' reconhecida mas não suportada (precisa de contexto de anexação de policy, não modelado neste adapter) — tratando como não-concedida",
      )
      return false
    }

    this.logger.warn(`evaluateCondition: condition não reconhecida, tratando como não-concedida: ${condition}`)
    return false
  }

  private parseStringArgs(argsRaw: string): string[] {
    return [...argsRaw.matchAll(/'([^']+)'/g)].map((m) => m[1])
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
