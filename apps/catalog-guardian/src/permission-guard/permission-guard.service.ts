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

// Requisito de negócio (casos NEG-002 / OWN-003 / OWN-004 do golden dataset):
// um campo restrito NUNCA desaparece em silêncio — ele vira um rótulo
// explícito. O único campo sempre visível independente de nível de acesso é
// o "owner" (metadado administrativo, não é o dado em si) — ver
// getOwnerOnly(). Tudo o mais no conteúdo do ativo segue o accessLevel:
//   'none' → conteúdo inteiro vira "[RESTRITO: nível none]"
//   'read' → conteúdo visível, mas colunas de PII ficam rotuladas
//   'full' → conteúdo completo
@Injectable()
export class PermissionGuardService {
  constructor(@Inject(CATALOG_ADAPTER) private readonly adapter: CatalogAdapter) {}

  async buildContext(userId: string, assets: GuardableAsset[]): Promise<GuardedAsset[]> {
    const guarded: GuardedAsset[] = []
    for (const asset of assets) {
      const accessLevel = await this.adapter.getUserAccessLevel(userId, asset.externalId)
      guarded.push(this.applyGuard(asset, accessLevel))
    }
    return guarded
  }

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
