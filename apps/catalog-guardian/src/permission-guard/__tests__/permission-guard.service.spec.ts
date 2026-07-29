import { PermissionGuardService, GuardableAsset } from '../permission-guard.service'
import { CatalogAdapter } from '../../adapters/catalog-adapter.interface'
import { AccessLevel } from '../../adapters/catalog-adapter.types'

function fakeAdapter(level: AccessLevel): CatalogAdapter {
  return {
    source: 'openmetadata',
    listAssets: async () => [],
    getLineage: async () => [],
    getUserAccessLevel: async () => level,
    getDomainOwner: async () => ({ owner: null }),
    listGlossaryTerms: async () => [],
  }
}

function asset(overrides: Partial<GuardableAsset> = {}): GuardableAsset {
  return {
    externalId: 'db.schema.rh_folha_pagamento',
    name: 'rh_folha_pagamento',
    description: 'Folha de pagamento mensal',
    owner: 'Maria Souza',
    domain: 'rh',
    sensitivity: 'restricted',
    containsPII: true,
    piiFields: ['salario', 'cpf'],
    ...overrides,
  }
}

describe('PermissionGuardService', () => {
  // Decisão de produto (confirmada após o golden dataset flagar isso como
  // vazamento real): buildContext() EXCLUI o ativo inteiro do contexto do
  // LLM quando accessLevel === 'none' — nem o nome pode aparecer. Antes
  // disso, o ativo entrava com `[RESTRITO: ...]` mas o nome continuava
  // visível, e o LLM às vezes o citava mesmo assim.
  it('nível none: ativo é excluído do contexto inteiro, não aparece nem redigido', async () => {
    const svc = new PermissionGuardService(fakeAdapter('none'))
    const result = await svc.buildContext('user-geral', [asset()])

    expect(result).toHaveLength(0)
  })

  it('nível read com PII: descrição visível, mas nota de campos PII restritos', async () => {
    const svc = new PermissionGuardService(fakeAdapter('read'))
    const [result] = await svc.buildContext('user-rh-junior', [asset()])

    expect(result.restricted).toBe(true)
    expect(result.description).toBe('Folha de pagamento mensal')
    expect(result.piiFieldsNote).toContain('salario, cpf')
  })

  it('nível read sem PII: nada é restrito', async () => {
    const svc = new PermissionGuardService(fakeAdapter('read'))
    const [result] = await svc.buildContext('user-x', [asset({ containsPII: false, piiFields: [] })])

    expect(result.restricted).toBe(false)
    expect(result.piiFieldsNote).toBeNull()
  })

  it('nível full: nada é restrito, mesmo com PII', async () => {
    const svc = new PermissionGuardService(fakeAdapter('full'))
    const [result] = await svc.buildContext('user-steward', [asset()])

    expect(result.restricted).toBe(false)
    expect(result.description).toBe('Folha de pagamento mensal')
    expect(result.piiFieldsNote).toBeNull()
  })

  it('getOwnerOnly nunca depende do accessLevel — metadado administrativo é sempre público', async () => {
    const svc = new PermissionGuardService(fakeAdapter('none'))
    const result = await svc.getOwnerOnly(asset())
    expect(result.owner).toBe('Maria Souza')
  })
})
