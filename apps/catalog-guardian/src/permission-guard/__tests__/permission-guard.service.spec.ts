import { PermissionGuardService, GuardableAsset, GuardedAsset } from '../permission-guard.service'
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
    listDomains: async () => [],
  }
}

// Fake Prisma mínimo — só catalogAsset.findMany, usado por
// buildLineageContext(). `rows` simula o retorno já no shape que o select
// aninhado (lineageFrom/lineageTo → source/target) produziria de verdade.
function fakePrisma(rows: Array<Record<string, unknown>> = []) {
  const findMany = jest.fn(async () => rows)
  return { prisma: { catalogAsset: { findMany } } as any, findMany }
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

function guardedAsset(overrides: Partial<GuardedAsset> = {}): GuardedAsset {
  return {
    externalId: 'db.schema.pedidos',
    name: 'pedidos',
    owner: 'steward',
    accessLevel: 'full',
    restricted: false,
    description: 'Pedidos de venda',
    piiFieldsNote: null,
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
    const { prisma } = fakePrisma()
    const svc = new PermissionGuardService(fakeAdapter('none'), prisma)
    const result = await svc.buildContext('user-geral', [asset()])

    expect(result).toHaveLength(0)
  })

  it('nível read com PII: descrição visível, mas nota de campos PII restritos', async () => {
    const { prisma } = fakePrisma()
    const svc = new PermissionGuardService(fakeAdapter('read'), prisma)
    const [result] = await svc.buildContext('user-rh-junior', [asset()])

    expect(result.restricted).toBe(true)
    expect(result.description).toBe('Folha de pagamento mensal')
    expect(result.piiFieldsNote).toContain('salario, cpf')
  })

  it('nível read sem PII: nada é restrito', async () => {
    const { prisma } = fakePrisma()
    const svc = new PermissionGuardService(fakeAdapter('read'), prisma)
    const [result] = await svc.buildContext('user-x', [asset({ containsPII: false, piiFields: [] })])

    expect(result.restricted).toBe(false)
    expect(result.piiFieldsNote).toBeNull()
  })

  it('nível full: nada é restrito, mesmo com PII', async () => {
    const { prisma } = fakePrisma()
    const svc = new PermissionGuardService(fakeAdapter('full'), prisma)
    const [result] = await svc.buildContext('user-steward', [asset()])

    expect(result.restricted).toBe(false)
    expect(result.description).toBe('Folha de pagamento mensal')
    expect(result.piiFieldsNote).toBeNull()
  })

  it('getOwnerOnly nunca depende do accessLevel — metadado administrativo é sempre público', async () => {
    const { prisma } = fakePrisma()
    const svc = new PermissionGuardService(fakeAdapter('none'), prisma)
    const result = await svc.getOwnerOnly(asset())
    expect(result.owner).toBe('Maria Souza')
  })

  describe('buildLineageContext — backlog "linhagem na resposta" (QA-CHECKLIST.md § 12)', () => {
    it('lista vazia de ativos: retorna mapa vazio sem consultar o banco', async () => {
      const { prisma, findMany } = fakePrisma()
      const svc = new PermissionGuardService(fakeAdapter('full'), prisma)

      const result = await svc.buildLineageContext('user-x', [])

      expect(result.size).toBe(0)
      expect(findMany).not.toHaveBeenCalled()
    })

    it('vizinho visível (mesmo domínio): aparece pelo nome, upstream e downstream nas direções certas', async () => {
      const { prisma } = fakePrisma([
        {
          externalId: 'db.schema.pedidos',
          lineageFrom: [{ source: { externalId: 'db.schema.estoque', name: 'estoque' } }],
          lineageTo: [{ target: { externalId: 'db.schema.faturamento', name: 'faturamento' } }],
        },
      ])
      // Adapter concede acesso a qualquer externalId perguntado — simula que
      // os vizinhos estão no mesmo domínio do usuário.
      const adapter = fakeAdapter('full')
      const svc = new PermissionGuardService(adapter, prisma)

      const result = await svc.buildLineageContext('user-x', [guardedAsset({ externalId: 'db.schema.pedidos' })])

      const lineage = result.get('db.schema.pedidos')!
      expect(lineage.upstreamNames).toEqual(['estoque'])
      expect(lineage.upstreamHiddenCount).toBe(0)
      expect(lineage.downstreamNames).toEqual(['faturamento'])
      expect(lineage.downstreamHiddenCount).toBe(0)
    })

    it('vizinho fora do domínio (accessLevel none): vira contagem, nunca o nome', async () => {
      const { prisma } = fakePrisma([
        {
          externalId: 'db.schema.pedidos',
          lineageFrom: [{ source: { externalId: 'db.schema.rh_folha_pagamento', name: 'rh_folha_pagamento' } }],
          lineageTo: [],
        },
      ])
      const svc = new PermissionGuardService(fakeAdapter('none'), prisma)

      const result = await svc.buildLineageContext('user-geral', [guardedAsset({ externalId: 'db.schema.pedidos' })])

      const lineage = result.get('db.schema.pedidos')!
      expect(lineage.upstreamNames).toEqual([])
      expect(lineage.upstreamHiddenCount).toBe(1)
    })

    it('vizinho que já está no próprio guarded: não dispara checagem de permissão nenhuma (permissão já conhecida)', async () => {
      const { prisma } = fakePrisma([
        {
          externalId: 'db.schema.pedidos',
          lineageFrom: [{ source: { externalId: 'db.schema.estoque', name: 'estoque' } }],
          lineageTo: [],
        },
        {
          externalId: 'db.schema.estoque',
          lineageFrom: [],
          lineageTo: [{ target: { externalId: 'db.schema.pedidos', name: 'pedidos' } }],
        },
      ])
      const getUserAccessLevel = jest.fn(async () => 'full' as AccessLevel)
      const adapter: CatalogAdapter = { ...fakeAdapter('full'), getUserAccessLevel }
      const svc = new PermissionGuardService(adapter, prisma)

      await svc.buildLineageContext('user-x', [
        guardedAsset({ externalId: 'db.schema.pedidos' }),
        guardedAsset({ externalId: 'db.schema.estoque' }),
      ])

      // "estoque" é vizinho de "pedidos" e vice-versa, mas os dois já estão
      // no guarded — nenhuma chamada de permissão deveria acontecer.
      expect(getUserAccessLevel).not.toHaveBeenCalled()
    })

    it('mesmo vizinho compartilhado por dois ativos: checa a permissão dele só 1 vez (dedupe)', async () => {
      const { prisma } = fakePrisma([
        {
          externalId: 'db.schema.a',
          lineageFrom: [{ source: { externalId: 'db.schema.hub', name: 'hub' } }],
          lineageTo: [],
        },
        {
          externalId: 'db.schema.b',
          lineageFrom: [{ source: { externalId: 'db.schema.hub', name: 'hub' } }],
          lineageTo: [],
        },
      ])
      const getUserAccessLevel = jest.fn(async () => 'full' as AccessLevel)
      const adapter: CatalogAdapter = { ...fakeAdapter('full'), getUserAccessLevel }
      const svc = new PermissionGuardService(adapter, prisma)

      await svc.buildLineageContext('user-x', [
        guardedAsset({ externalId: 'db.schema.a' }),
        guardedAsset({ externalId: 'db.schema.b' }),
      ])

      expect(getUserAccessLevel).toHaveBeenCalledTimes(1)
      expect(getUserAccessLevel).toHaveBeenCalledWith('user-x', 'db.schema.hub')
    })

    it('ativo sem nenhuma aresta: entrada com listas vazias (draftAnswer trata como "sem linhagem registrada")', async () => {
      const { prisma } = fakePrisma([{ externalId: 'db.schema.isolado', lineageFrom: [], lineageTo: [] }])
      const svc = new PermissionGuardService(fakeAdapter('full'), prisma)

      const result = await svc.buildLineageContext('user-x', [guardedAsset({ externalId: 'db.schema.isolado' })])

      const lineage = result.get('db.schema.isolado')!
      expect(lineage.upstreamNames).toEqual([])
      expect(lineage.downstreamNames).toEqual([])
      expect(lineage.upstreamHiddenCount).toBe(0)
      expect(lineage.downstreamHiddenCount).toBe(0)
    })
  })
})
