import { ConfigService } from '@nestjs/config'
import { OpenMetadataAdapter } from '../openmetadata.adapter'

// ConfigService fake — só precisa do .get(key, default) usado pelo adapter.
function fakeConfig(): ConfigService {
  return { get: (_key: string, defaultValue?: unknown) => defaultValue } as unknown as ConfigService
}

const PII_TABLE = {
  id: 't1',
  name: 'clientes',
  fullyQualifiedName: 'service.db.schema.clientes',
  tags: [{ tagFQN: 'PII.Sensitive' }],
  domains: [{ id: 'd1', type: 'domain', name: 'vendas' }],
}

const PLAIN_TABLE = {
  id: 't2',
  name: 'produtos',
  fullyQualifiedName: 'service.db.schema.produtos',
  tags: [],
  domains: [{ id: 'd1', type: 'domain', name: 'vendas' }],
}

const PII_VIEWER_ROLE = { id: 'r1', type: 'role', name: 'PIIViewer' }

// Mock de fetch por rota — cada teste registra só as respostas que precisa;
// qualquer URL não mapeada falha alto (erro claro em vez de undefined silencioso).
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

describe('OpenMetadataAdapter.getUserAccessLevel', () => {
  afterEach(() => jest.restoreAllMocks())

  it('ativo PII, domínio certo, usuário sem role: read (comportamento pré-existente)', async () => {
    mockFetch({
      '/v1/tables/name/': PII_TABLE,
      '/v1/users/name/': { domains: [{ name: 'vendas' }], roles: [] },
    })
    const adapter = new OpenMetadataAdapter(fakeConfig())

    const level = await adapter.getUserAccessLevel('geral', PII_TABLE.fullyQualifiedName)

    expect(level).toBe('read')
  })

  it('ativo PII, domínio certo, role com policy allow+matchAnyTag(PII.Sensitive): full', async () => {
    mockFetch({
      '/v1/tables/name/': PII_TABLE,
      '/v1/users/name/': { domains: [{ name: 'vendas' }], roles: [PII_VIEWER_ROLE] },
      '/v1/roles/name/PIIViewer': { name: 'PIIViewer', policies: [{ id: 'p1', type: 'policy', name: 'PIIViewerPolicy' }] },
      '/v1/policies/name/PIIViewerPolicy': {
        rules: [{ name: 'AllowViewAllPII', resources: ['table'], operations: ['ViewAll'], effect: 'allow', condition: "matchAnyTag('PII.Sensitive')" }],
      },
    })
    const adapter = new OpenMetadataAdapter(fakeConfig())

    const level = await adapter.getUserAccessLevel('steward', PII_TABLE.fullyQualifiedName)

    expect(level).toBe('full')
  })

  it('mesma role, mas ativo fora do domínio do usuário: none — gate de domínio vence, clearance não importa', async () => {
    mockFetch({
      '/v1/tables/name/': PII_TABLE, // domínio 'vendas'
      '/v1/users/name/': { domains: [{ name: 'rh' }], roles: [PII_VIEWER_ROLE] },
    })
    const adapter = new OpenMetadataAdapter(fakeConfig())

    const level = await adapter.getUserAccessLevel('steward', PII_TABLE.fullyQualifiedName)

    expect(level).toBe('none')
  })

  it('ativo não-PII: full sempre, sem sequer consultar role/policy', async () => {
    const calls = mockFetch({
      '/v1/tables/name/': PLAIN_TABLE,
      '/v1/users/name/': { domains: [{ name: 'vendas' }], roles: [] },
    })
    const adapter = new OpenMetadataAdapter(fakeConfig())

    const level = await adapter.getUserAccessLevel('geral', PLAIN_TABLE.fullyQualifiedName)

    expect(level).toBe('full')
    expect(calls.some((u) => u.includes('/v1/roles/'))).toBe(false)
  })

  it('condition não reconhecida: fail-closed, nunca concede clearance', async () => {
    mockFetch({
      '/v1/tables/name/': PII_TABLE,
      '/v1/users/name/': { domains: [{ name: 'vendas' }], roles: [PII_VIEWER_ROLE] },
      '/v1/roles/name/PIIViewer': { name: 'PIIViewer', policies: [{ id: 'p1', type: 'policy', name: 'WeirdPolicy' }] },
      '/v1/policies/name/WeirdPolicy': {
        rules: [{ name: 'Weird', resources: ['table'], operations: ['ViewAll'], effect: 'allow', condition: "isOwner()" }],
      },
    })
    const adapter = new OpenMetadataAdapter(fakeConfig())

    const level = await adapter.getUserAccessLevel('steward', PII_TABLE.fullyQualifiedName)

    expect(level).toBe('read')
  })

  it('item 7: deny explícito vence allow — policy com allow amplo + deny específico nunca concede clearance', async () => {
    mockFetch({
      '/v1/tables/name/': PII_TABLE,
      '/v1/users/name/': { domains: [{ name: 'vendas' }], roles: [PII_VIEWER_ROLE] },
      '/v1/roles/name/PIIViewer': { name: 'PIIViewer', policies: [{ id: 'p1', type: 'policy', name: 'PIIViewerPolicy' }] },
      '/v1/policies/name/PIIViewerPolicy': {
        rules: [
          { name: 'AllowViewAllPII', resources: ['table'], operations: ['ViewAll'], effect: 'allow', condition: "matchAnyTag('PII.Sensitive')" },
          { name: 'DenyViewAllPII', resources: ['table'], operations: ['ViewAll'], effect: 'deny', condition: "matchAnyTag('PII.Sensitive')" },
        ],
      },
    })
    const adapter = new OpenMetadataAdapter(fakeConfig())

    const level = await adapter.getUserAccessLevel('steward', PII_TABLE.fullyQualifiedName)

    expect(level).toBe('read')
  })
})
