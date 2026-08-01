import { Inject, Injectable } from '@nestjs/common'
import { CATALOG_ADAPTER, CatalogAdapter } from '../adapters/catalog-adapter.interface'
import { AccessLevel } from '../adapters/catalog-adapter.types'
import { PrismaService } from '../core/prisma.service'

// QA-CHECKLIST.md § 12 "Linhagem na resposta" — quantos vizinhos por direção
// entram no prompt. Mesmo valor do LIMIT 5 já usado em findRelevantAssets.
const LINEAGE_NEIGHBOR_LIMIT = 5

export interface LineageContext {
  upstreamNames: string[]
  upstreamHiddenCount: number
  downstreamNames: string[]
  downstreamHiddenCount: number
}

// Subconjunto de CatalogAsset que o guard precisa — evita acoplar este
// serviço ao client do Prisma inteiro (facilita teste com fixture simples).
export interface GuardableAsset {
  externalId: string
  name: string
  description: string | null
  owner: string | null
  domain: string | null
  sensitivity: string
  containsPII: boolean
  piiFields: string[] | null
  tags: string[]
}

export interface GuardedAsset {
  externalId: string
  name: string
  owner: string | null
  accessLevel: AccessLevel
  restricted: boolean
  description: string | null // null quando accessLevel === 'none'
  piiFieldsNote: string | null // "[RESTRITO: nível none]" quando aplicável
  // QA-CHECKLIST.md § 12 "Qualidade/certificação via tags" — propagado
  // mesmo quando restricted: true (mesmo precedente de owner já visível
  // em ativo restrito). Conteúdo bruto do catálogo fonte, não vocabulário
  // controlado nosso — só existe de verdade no OMD (UC hardcoda tags: []).
  tags: string[]
}

// Decisão de produto confirmada após a validação real contra o golden
// dataset: citar o NOME de um ativo fora do domínio do usuário já conta
// como vazamento de permissão — mesmo com o conteúdo redigido. Por isso
// accessLevel 'none' (fora do domínio) faz o ativo ser EXCLUÍDO do contexto
// inteiro em buildContext(), não apenas com o conteúdo nulado — o LLM nunca
// chega a ver que esse ativo existe. (Versão anterior incluía o nome com
// `[RESTRITO: ...]`; o próprio golden dataset provou isso como vazamento.)
//
// Dentro do domínio certo, PII só redige campo a campo ('read'), sem
// excluir o ativo — ver applyGuard().
//
// O único caminho que ainda revela metadado administrativo (owner/steward)
// independente de domínio é getOwnerOnly() — não é chamado por buildContext,
// existe pra uma futura rota dedicada a pergunta de responsabilidade
// (OWN-003: "quem é o steward de X" é público mesmo sem acesso ao domínio,
// mas isso é uma pergunta *sobre* o ativo, não uma busca/descoberta geral).
@Injectable()
export class PermissionGuardService {
  constructor(
    @Inject(CATALOG_ADAPTER) private readonly adapter: CatalogAdapter,
    private readonly prisma: PrismaService,
  ) {}

  async buildContext(userId: string, assets: GuardableAsset[]): Promise<GuardedAsset[]> {
    const guarded: GuardedAsset[] = []
    for (const asset of assets) {
      const accessLevel = await this.adapter.getUserAccessLevel(userId, asset.externalId)
      if (accessLevel === 'none') continue // fora do domínio — nem o nome entra no contexto do LLM
      guarded.push(this.applyGuard(asset, accessLevel))
    }
    return guarded
  }

  // QA-CHECKLIST.md § 12 "Linhagem na resposta" — CatalogLineageEdge já é
  // sincronizado, mas até agora só alimentava o score de maturidade, nunca
  // chegava ao contexto do LLM (LIN-001..004 do golden dataset não tinham
  // como ser respondidos com dado real). lineageFrom = arestas onde ESTE
  // ativo é o alvo (dados vêm de `edge.source` = upstream); lineageTo =
  // arestas onde este ativo é a origem (dados vão pra `edge.target` =
  // downstream) — direções confirmadas contra o schema.prisma, não
  // deduzidas pelo nome do campo.
  //
  // Vizinho fora do domínio do usuário vira CONTAGEM, nunca nome — mesmo
  // princípio de buildContext() (citar nome fora de domínio já é vazamento).
  // Dedupe entre ativos + memoização por chamada evita que um hub table
  // dispare 1 chamada de permissão por vizinho POR ativo (multiplicador,
  // não soma) — getUserAccessLevel de ativo PII no OMD já custa várias
  // chamadas HTTP sozinho (resolveTeamHierarchy percorre times recursivo).
  async buildLineageContext(userId: string, guarded: GuardedAsset[]): Promise<Map<string, LineageContext>> {
    const result = new Map<string, LineageContext>()
    if (guarded.length === 0) return result

    const guardedExternalIds = new Set(guarded.map((g) => g.externalId))
    const rows = await this.prisma.catalogAsset.findMany({
      where: { externalId: { in: [...guardedExternalIds] } },
      select: {
        externalId: true,
        lineageFrom: { take: LINEAGE_NEIGHBOR_LIMIT, select: { source: { select: { externalId: true, name: true } } } },
        lineageTo: { take: LINEAGE_NEIGHBOR_LIMIT, select: { target: { select: { externalId: true, name: true } } } },
      },
    })

    // Descobre quais vizinhos (fora do próprio guarded, cuja permissão já é
    // conhecida) precisam de 1 checagem de permissão — nunca 1 por aresta.
    const toCheck = new Set<string>()
    for (const row of rows) {
      for (const edge of row.lineageFrom) {
        if (!guardedExternalIds.has(edge.source.externalId)) toCheck.add(edge.source.externalId)
      }
      for (const edge of row.lineageTo) {
        if (!guardedExternalIds.has(edge.target.externalId)) toCheck.add(edge.target.externalId)
      }
    }

    const visibility = new Map<string, boolean>()
    for (const externalId of toCheck) {
      const level = await this.adapter.getUserAccessLevel(userId, externalId)
      visibility.set(externalId, level !== 'none')
    }
    const isVisible = (externalId: string) => guardedExternalIds.has(externalId) || visibility.get(externalId) === true

    for (const row of rows) {
      const upstreamNames: string[] = []
      let upstreamHiddenCount = 0
      for (const edge of row.lineageFrom) {
        if (isVisible(edge.source.externalId)) upstreamNames.push(edge.source.name)
        else upstreamHiddenCount++
      }

      const downstreamNames: string[] = []
      let downstreamHiddenCount = 0
      for (const edge of row.lineageTo) {
        if (isVisible(edge.target.externalId)) downstreamNames.push(edge.target.name)
        else downstreamHiddenCount++
      }

      result.set(row.externalId, { upstreamNames, upstreamHiddenCount, downstreamNames, downstreamHiddenCount })
    }

    return result
  }

  // Metadado administrativo (owner/steward) é público mesmo sem acesso ao
  // domínio — saber QUEM é responsável não é o mesmo que VER o dado (OWN-003).
  async getOwnerOnly(asset: Pick<GuardableAsset, 'externalId' | 'owner' | 'domain'>) {
    return { externalId: asset.externalId, owner: asset.owner ?? null, domain: asset.domain }
  }

  private applyGuard(asset: GuardableAsset, accessLevel: AccessLevel): GuardedAsset {
    if (accessLevel === 'none') {
      return {
        externalId: asset.externalId,
        name: asset.name,
        owner: asset.owner,
        accessLevel,
        restricted: true,
        description: null,
        piiFieldsNote: `[RESTRITO: nível ${asset.sensitivity}]`,
        tags: asset.tags,
      }
    }

    const piiRestricted = accessLevel === 'read' && asset.containsPII
    return {
      externalId: asset.externalId,
      name: asset.name,
      owner: asset.owner,
      accessLevel,
      restricted: piiRestricted,
      description: asset.description,
      piiFieldsNote: piiRestricted
        ? `[RESTRITO: nível ${accessLevel} — campos PII omitidos: ${(asset.piiFields ?? []).join(', ') || 'não especificados'}]`
        : null,
      tags: asset.tags,
    }
  }
}
