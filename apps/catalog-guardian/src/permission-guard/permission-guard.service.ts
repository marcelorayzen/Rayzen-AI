import { Inject, Injectable } from '@nestjs/common'
import { CATALOG_ADAPTER, CatalogAdapter } from '../adapters/catalog-adapter.interface'
import { AccessLevel } from '../adapters/catalog-adapter.types'

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
}

export interface GuardedAsset {
  externalId: string
  name: string
  owner: string | null
  accessLevel: AccessLevel
  restricted: boolean
  description: string | null // null quando accessLevel === 'none'
  piiFieldsNote: string | null // "[RESTRITO: nível none]" quando aplicável
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
  constructor(@Inject(CATALOG_ADAPTER) private readonly adapter: CatalogAdapter) {}

  async buildContext(userId: string, assets: GuardableAsset[]): Promise<GuardedAsset[]> {
    const guarded: GuardedAsset[] = []
    for (const asset of assets) {
      const accessLevel = await this.adapter.getUserAccessLevel(userId, asset.externalId)
      if (accessLevel === 'none') continue // fora do domínio — nem o nome entra no contexto do LLM
      guarded.push(this.applyGuard(asset, accessLevel))
    }
    return guarded
  }

  // Ainda não é chamado por nenhuma rota (QueryService só usa buildContext).
  // TODO quando for ligar a um endpoint real: decidir se um lookup de um
  // único ativo por accessLevel 'none' deve devolver algo (como faz hoje,
  // via applyGuard) ou lançar/retornar null — mesma pergunta de produto que
  // já resolvemos para buildContext, ainda não decidida para este caminho.
  async guardOne(userId: string, asset: GuardableAsset): Promise<GuardedAsset> {
    const accessLevel = await this.adapter.getUserAccessLevel(userId, asset.externalId)
    return this.applyGuard(asset, accessLevel)
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
    }
  }
}
