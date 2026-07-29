import { ConfigService } from '@nestjs/config'
import { UnityCatalogAdapter } from '../unitycatalog.adapter'

function fakeConfig(): ConfigService {
  return { get: (_key: string, defaultValue?: unknown) => defaultValue } as unknown as ConfigService
}

const CATALOG_VENDAS = { name: 'vendas', owner: 'maria@empresa.com' }

const TABLE_PEDIDOS = {
  name: 'pedidos',
  catalog_name: 'vendas',
  schema_name: 'public',
  comment: 'Pedidos de venda',
  owner: 'steward@empresa.com',
  properties: {},
  columns: [{ name: 'id_pedido', properties: {} }],
}

const TABLE_CLIENTES_PII = {
  name: 'clientes',
  catalog_name: 'vendas',
  schema_name: 'public',
  comment: 'Cadastro de clientes',
  owner: null,
  properties: {},
  columns: [{ name: 'cpf', properties: { pii: 'true' } }],
}

// Mesmo padrão de openmetadata.adapter.spec.ts — mock de fetch por rota,
// URL não mapeada falha alto em vez de devolver undefined silencioso.
function mockFetch(routes: Record<string, unknown>) {
  const calls: string[] = []
  global.fetch = jest.fn(async (url: string) => {
    calls.push(url)
    const match = Object.keys(routes).find((pattern) => url.includes(pattern))
    if (!match) throw new Error(`URL não mapeada no mock: ${url}`)
    return {
      ok: true,
      json: async () => routes[match],
      text: async () => JSON.stringify(routes[match]),
    } as Response
  }) as unknown as typeof fetch
  return calls
}

describe('UnityCatalogAdapter', () => {
  afterEach(() => jest.restoreAllMocks())

  describe('listAssets', () => {
    it('pagina catalogs → schemas → tables e mapeia domain = nome do catalog', async () => {
      mockFetch({
        '/catalogs?': { catalogs: [CATALOG_VENDAS] },
        '/schemas?': { schemas: [{ name: 'public', catalog_name: 'vendas' }] },
        '/tables?': { tables: [TABLE_PEDIDOS] },
      })
      const adapter = new UnityCatalogAdapter(fakeConfig())

      const assets = await adapter.listAssets()

      expect(assets).toHaveLength(1)
      expect(assets[0]).toMatchObject({
        externalId: 'vendas.public.pedidos',
        domain: 'vendas',
        owner: 'steward@empresa.com',
        containsPII: false,
      })
    })

    it('marca containsPII quando alguma coluna tem properties.pii=true', async () => {
      mockFetch({
        '/catalogs?': { catalogs: [CATALOG_VENDAS] },
        '/schemas?': { schemas: [{ name: 'public', catalog_name: 'vendas' }] },
        '/tables?': { tables: [TABLE_CLIENTES_PII] },
      })
      const adapter = new UnityCatalogAdapter(fakeConfig())

      const assets = await adapter.listAssets()

      expect(assets[0].containsPII).toBe(true)
      expect(assets[0].sensitivity).toBe('restricted')
      expect(assets[0].piiFields).toEqual(['cpf'])
    })
  })

  it('getLineage sempre retorna vazio — limitação real da versão OSS (issue #137)', async () => {
    const adapter = new UnityCatalogAdapter(fakeConfig())
    await expect(adapter.getLineage('vendas.public.pedidos')).resolves.toEqual([])
  })

  it('listGlossaryTerms sempre retorna vazio — sem conceito equivalente na UC', async () => {
    const adapter = new UnityCatalogAdapter(fakeConfig())
    await expect(adapter.listGlossaryTerms()).resolves.toEqual([])
  })

  describe('getUserAccessLevel', () => {
    it('sem privilege em nenhum nível (table/schema/catalog): none', async () => {
      mockFetch({
        '/tables/': TABLE_PEDIDOS,
        '/permissions/': { privilege_assignments: [] },
      })
      const adapter = new UnityCatalogAdapter(fakeConfig())

      const level = await adapter.getUserAccessLevel('geral@empresa.com', 'vendas.public.pedidos')

      expect(level).toBe('none')
    })

    it('privilege SELECT direto na tabela, ativo não-PII: full', async () => {
      mockFetch({
        '/tables/': TABLE_PEDIDOS,
        '/permissions/table/': { privilege_assignments: [{ principal: 'geral@empresa.com', privileges: ['SELECT'] }] },
      })
      const adapter = new UnityCatalogAdapter(fakeConfig())

      const level = await adapter.getUserAccessLevel('geral@empresa.com', 'vendas.public.pedidos')

      expect(level).toBe('full')
    })

    it('privilege herdado do catalog (nenhum na tabela/schema), ativo PII: read', async () => {
      global.fetch = jest.fn(async (url: string) => {
        if (url.includes('/tables/')) return { ok: true, json: async () => TABLE_CLIENTES_PII } as Response
        if (url.includes('/permissions/table/') || url.includes('/permissions/schema/')) {
          return { ok: true, json: async () => ({ privilege_assignments: [] }) } as Response
        }
        if (url.includes('/permissions/catalog/')) {
          return {
            ok: true,
            json: async () => ({ privilege_assignments: [{ principal: 'geral@empresa.com', privileges: ['SELECT'] }] }),
          } as Response
        }
        throw new Error(`URL não mapeada: ${url}`)
      }) as unknown as typeof fetch
      const adapter = new UnityCatalogAdapter(fakeConfig())

      const level = await adapter.getUserAccessLevel('geral@empresa.com', 'vendas.public.clientes')

      expect(level).toBe('read')
    })
  })

  it('getDomainOwner lê o owner do catalog UC', async () => {
    mockFetch({ '/catalogs/': CATALOG_VENDAS })
    const adapter = new UnityCatalogAdapter(fakeConfig())

    const result = await adapter.getDomainOwner('vendas')

    expect(result).toEqual({ owner: 'maria@empresa.com' })
  })
})
