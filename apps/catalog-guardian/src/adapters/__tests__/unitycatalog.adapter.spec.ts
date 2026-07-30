import { ConfigService } from '@nestjs/config'
import { UnityCatalogAdapter } from '../unitycatalog.adapter'

function fakeConfig(): ConfigService {
  return { get: (_key: string, defaultValue?: unknown) => defaultValue } as unknown as ConfigService
}

// Backlog "domínio=catalog" fechado: catalog virou namespace/ambiente
// ("producao"), schema é o domínio de negócio de verdade ("vendas") —
// exatamente a palavra que extractDomainMention() casa contra a pergunta em
// linguagem natural. Fixtures deste arquivo refletem esse modelo, não o
// antigo (1 catalog por domínio, schema "public" fixo).
const CATALOG_PRODUCAO = { name: 'producao' }
const SCHEMA_VENDAS = { name: 'vendas', catalog_name: 'producao', owner: 'maria@empresa.com' }

const TABLE_PEDIDOS = {
  name: 'pedidos',
  catalog_name: 'producao',
  schema_name: 'vendas',
  comment: 'Pedidos de venda',
  owner: 'steward@empresa.com',
  properties: {},
  columns: [{ name: 'id_pedido', properties: {} }],
}

const TABLE_CLIENTES_PII = {
  name: 'clientes',
  catalog_name: 'producao',
  schema_name: 'vendas',
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
    it('pagina catalogs → schemas → tables e mapeia domain = nome do SCHEMA (não do catalog)', async () => {
      mockFetch({
        '/catalogs?': { catalogs: [CATALOG_PRODUCAO] },
        '/schemas?': { schemas: [SCHEMA_VENDAS] },
        '/tables?': { tables: [TABLE_PEDIDOS] },
      })
      const adapter = new UnityCatalogAdapter(fakeConfig())

      const assets = await adapter.listAssets()

      expect(assets).toHaveLength(1)
      expect(assets[0]).toMatchObject({
        externalId: 'producao.vendas.pedidos',
        domain: 'vendas',
        owner: 'steward@empresa.com',
        containsPII: false,
      })
    })

    it('marca containsPII quando alguma coluna tem properties.pii=true', async () => {
      mockFetch({
        '/catalogs?': { catalogs: [CATALOG_PRODUCAO] },
        '/schemas?': { schemas: [SCHEMA_VENDAS] },
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
    await expect(adapter.getLineage('producao.vendas.pedidos')).resolves.toEqual([])
  })

  it('listGlossaryTerms sempre retorna vazio — sem conceito equivalente na UC', async () => {
    const adapter = new UnityCatalogAdapter(fakeConfig())
    await expect(adapter.listGlossaryTerms()).resolves.toEqual([])
  })

  describe('listDomains — backlog "KNOWN_DOMAINS hardcoded" fechado junto', () => {
    it('lista nomes de schema de todos os catalogs, sem duplicar', async () => {
      mockFetch({
        '/catalogs?': { catalogs: [{ name: 'producao' }, { name: 'staging' }] },
        '/schemas?catalog_name=producao': { schemas: [SCHEMA_VENDAS, { name: 'financeiro', catalog_name: 'producao' }] },
        '/schemas?catalog_name=staging': { schemas: [{ name: 'vendas', catalog_name: 'staging' }] },
      })
      const adapter = new UnityCatalogAdapter(fakeConfig())

      const domains = await adapter.listDomains()

      // "vendas" existe em dois catalogs (producao/staging) — dedupado.
      expect(domains.sort()).toEqual(['financeiro', 'vendas'])
    })
  })

  describe('getUserAccessLevel', () => {
    it('sem privilege em nenhum nível (table/schema/catalog): none', async () => {
      mockFetch({
        '/tables/': TABLE_PEDIDOS,
        '/permissions/': { privilege_assignments: [] },
      })
      const adapter = new UnityCatalogAdapter(fakeConfig())

      const level = await adapter.getUserAccessLevel('geral@empresa.com', 'producao.vendas.pedidos')

      expect(level).toBe('none')
    })

    it('privilege SELECT direto na tabela, ativo não-PII: full', async () => {
      mockFetch({
        '/tables/': TABLE_PEDIDOS,
        '/permissions/table/': { privilege_assignments: [{ principal: 'geral@empresa.com', privileges: ['SELECT'] }] },
      })
      const adapter = new UnityCatalogAdapter(fakeConfig())

      const level = await adapter.getUserAccessLevel('geral@empresa.com', 'producao.vendas.pedidos')

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

      const level = await adapter.getUserAccessLevel('geral@empresa.com', 'producao.vendas.clientes')

      expect(level).toBe('read')
    })
  })

  describe('getDomainOwner — domain agora é nome de SCHEMA, não de catalog', () => {
    it('encontra o schema no primeiro catalog que o contém e lê o owner dele', async () => {
      mockFetch({
        '/catalogs?': { catalogs: [CATALOG_PRODUCAO] },
        '/schemas/producao.vendas': SCHEMA_VENDAS,
      })
      const adapter = new UnityCatalogAdapter(fakeConfig())

      const result = await adapter.getDomainOwner('vendas')

      expect(result).toEqual({ owner: 'maria@empresa.com' })
    })

    it('percorre catalogs até achar o schema — não para no primeiro catalog se ele não tiver esse schema', async () => {
      global.fetch = jest.fn(async (url: string) => {
        if (url.includes('/catalogs?')) return { ok: true, json: async () => ({ catalogs: [{ name: 'staging' }, { name: 'producao' }] }) } as Response
        if (url.includes('/schemas/staging.vendas')) return { ok: false, status: 404, text: async () => 'not found' } as Response
        if (url.includes('/schemas/producao.vendas')) return { ok: true, json: async () => SCHEMA_VENDAS } as Response
        throw new Error(`URL não mapeada: ${url}`)
      }) as unknown as typeof fetch
      const adapter = new UnityCatalogAdapter(fakeConfig())

      const result = await adapter.getDomainOwner('vendas')

      expect(result).toEqual({ owner: 'maria@empresa.com' })
    })

    it('nenhum catalog tem esse schema: owner null, não lança erro', async () => {
      global.fetch = jest.fn(async (url: string) => {
        if (url.includes('/catalogs?')) return { ok: true, json: async () => ({ catalogs: [CATALOG_PRODUCAO] }) } as Response
        if (url.includes('/schemas/')) return { ok: false, status: 404, text: async () => 'not found' } as Response
        throw new Error(`URL não mapeada: ${url}`)
      }) as unknown as typeof fetch
      const adapter = new UnityCatalogAdapter(fakeConfig())

      const result = await adapter.getDomainOwner('inexistente')

      expect(result).toEqual({ owner: null })
    })
  })
})
