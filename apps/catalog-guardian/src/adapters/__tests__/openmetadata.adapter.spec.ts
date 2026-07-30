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

  it('condition não reconhecida (isReviewer, não implementada): fail-closed, nunca concede clearance', async () => {
    mockFetch({
      '/v1/tables/name/': PII_TABLE,
      '/v1/users/name/': { domains: [{ name: 'vendas' }], roles: [PII_VIEWER_ROLE] },
      '/v1/roles/name/PIIViewer': { name: 'PIIViewer', policies: [{ id: 'p1', type: 'policy', name: 'WeirdPolicy' }] },
      '/v1/policies/name/WeirdPolicy': {
        rules: [{ name: 'Weird', resources: ['table'], operations: ['ViewAll'], effect: 'allow', condition: "isReviewer()" }],
      },
    })
    const adapter = new OpenMetadataAdapter(fakeConfig())

    const level = await adapter.getUserAccessLevel('steward', PII_TABLE.fullyQualifiedName)

    expect(level).toBe('read')
  })

  it('backlog identidade — isOwner(): concede clearance quando o usuário é dono direto do ativo', async () => {
    const owned = { ...PII_TABLE, owners: [{ id: 'u1', type: 'user', name: 'steward' }] }
    mockFetch({
      '/v1/tables/name/': owned,
      '/v1/users/name/': { domains: [{ name: 'vendas' }], roles: [PII_VIEWER_ROLE] },
      '/v1/roles/name/PIIViewer': { name: 'PIIViewer', policies: [{ id: 'p1', type: 'policy', name: 'OwnerPolicy' }] },
      '/v1/policies/name/OwnerPolicy': {
        rules: [{ name: 'AllowOwner', resources: ['table'], operations: ['ViewAll'], effect: 'allow', condition: 'isOwner()' }],
      },
    })
    const adapter = new OpenMetadataAdapter(fakeConfig())

    const level = await adapter.getUserAccessLevel('steward', owned.fullyQualifiedName)

    expect(level).toBe('full')
  })

  it('backlog identidade — isOwner(): concede clearance quando o dono é um TIME do qual o usuário é membro direto', async () => {
    const owned = { ...PII_TABLE, owners: [{ id: 'tm1', type: 'team', name: 'squad-dados' }] }
    mockFetch({
      '/v1/tables/name/': owned,
      '/v1/users/name/': { domains: [{ name: 'vendas' }], roles: [PII_VIEWER_ROLE], teams: [{ id: 't1', type: 'team', name: 'squad-dados' }] },
      '/v1/roles/name/PIIViewer': { name: 'PIIViewer', policies: [{ id: 'p1', type: 'policy', name: 'OwnerPolicy' }] },
      '/v1/policies/name/OwnerPolicy': {
        rules: [{ name: 'AllowOwner', resources: ['table'], operations: ['ViewAll'], effect: 'allow', condition: 'isOwner()' }],
      },
      '/v1/teams/name/squad-dados': { name: 'squad-dados', defaultRoles: [], parents: [] },
    })
    const adapter = new OpenMetadataAdapter(fakeConfig())

    const level = await adapter.getUserAccessLevel('geral', owned.fullyQualifiedName)

    expect(level).toBe('full')
  })

  it('backlog identidade — isOwner(): não concede quando o usuário não é dono nem membro do time dono', async () => {
    const owned = { ...PII_TABLE, owners: [{ id: 'u1', type: 'user', name: 'outra-pessoa' }] }
    mockFetch({
      '/v1/tables/name/': owned,
      '/v1/users/name/': { domains: [{ name: 'vendas' }], roles: [PII_VIEWER_ROLE], teams: [] },
      '/v1/roles/name/PIIViewer': { name: 'PIIViewer', policies: [{ id: 'p1', type: 'policy', name: 'OwnerPolicy' }] },
      '/v1/policies/name/OwnerPolicy': {
        rules: [{ name: 'AllowOwner', resources: ['table'], operations: ['ViewAll'], effect: 'allow', condition: 'isOwner()' }],
      },
    })
    const adapter = new OpenMetadataAdapter(fakeConfig())

    const level = await adapter.getUserAccessLevel('geral', owned.fullyQualifiedName)

    expect(level).toBe('read')
  })

  it('backlog identidade — hasAnyRole(): concede clearance por role herdada de team.defaultRoles, sem estar atribuída direto ao usuário', async () => {
    mockFetch({
      '/v1/tables/name/': PII_TABLE,
      // Usuário NÃO tem PIIViewer atribuída direto — só pertence a um time
      // cujo defaultRoles concede a role. Este é o caso real que o adapter
      // antigo (só roles diretas) nunca detectava.
      '/v1/users/name/': { domains: [{ name: 'vendas' }], roles: [], teams: [{ id: 't1', type: 'team', name: 'squad-dados' }] },
      '/v1/teams/name/squad-dados': { name: 'squad-dados', defaultRoles: [PII_VIEWER_ROLE], parents: [] },
      '/v1/roles/name/PIIViewer': { name: 'PIIViewer', policies: [{ id: 'p1', type: 'policy', name: 'RolePolicy' }] },
      '/v1/policies/name/RolePolicy': {
        rules: [{ name: 'AllowRole', resources: ['table'], operations: ['ViewAll'], effect: 'allow', condition: "hasAnyRole('PIIViewer')" }],
      },
    })
    const adapter = new OpenMetadataAdapter(fakeConfig())

    const level = await adapter.getUserAccessLevel('geral', PII_TABLE.fullyQualifiedName)

    expect(level).toBe('full')
  })

  it('backlog identidade — hasAnyRole(): sobe hierarquia de times (team.parents) pra herdar role de um time avô', async () => {
    mockFetch({
      '/v1/tables/name/': PII_TABLE,
      '/v1/users/name/': { domains: [{ name: 'vendas' }], roles: [], teams: [{ id: 't1', type: 'team', name: 'squad-dados' }] },
      // squad-dados não concede a role diretamente — só o time-pai concede.
      '/v1/teams/name/squad-dados': { name: 'squad-dados', defaultRoles: [], parents: [{ id: 't0', type: 'team', name: 'engenharia' }] },
      '/v1/teams/name/engenharia': { name: 'engenharia', defaultRoles: [PII_VIEWER_ROLE], parents: [] },
      '/v1/roles/name/PIIViewer': { name: 'PIIViewer', policies: [{ id: 'p1', type: 'policy', name: 'RolePolicy' }] },
      '/v1/policies/name/RolePolicy': {
        rules: [{ name: 'AllowRole', resources: ['table'], operations: ['ViewAll'], effect: 'allow', condition: "hasAnyRole('PIIViewer')" }],
      },
    })
    const adapter = new OpenMetadataAdapter(fakeConfig())

    const level = await adapter.getUserAccessLevel('geral', PII_TABLE.fullyQualifiedName)

    expect(level).toBe('full')
  })

  it('backlog identidade — hasAnyRole(): protege contra ciclo de hierarquia de times (A→B→A) sem travar', async () => {
    mockFetch({
      '/v1/tables/name/': PII_TABLE,
      '/v1/users/name/': { domains: [{ name: 'vendas' }], roles: [], teams: [{ id: 't1', type: 'team', name: 'time-a' }] },
      '/v1/teams/name/time-a': { name: 'time-a', defaultRoles: [], parents: [{ id: 't2', type: 'team', name: 'time-b' }] },
      '/v1/teams/name/time-b': { name: 'time-b', defaultRoles: [], parents: [{ id: 't1', type: 'team', name: 'time-a' }] },
    })
    const adapter = new OpenMetadataAdapter(fakeConfig())

    const level = await adapter.getUserAccessLevel('geral', PII_TABLE.fullyQualifiedName)

    expect(level).toBe('read')
  })

  it('backlog identidade — inAnyTeam(): concede quando o usuário está sob a hierarquia do time citado (via time-pai)', async () => {
    mockFetch({
      '/v1/tables/name/': PII_TABLE,
      '/v1/users/name/': { domains: [{ name: 'vendas' }], roles: [PII_VIEWER_ROLE], teams: [{ id: 't1', type: 'team', name: 'squad-dados' }] },
      '/v1/teams/name/squad-dados': { name: 'squad-dados', defaultRoles: [], parents: [{ id: 't0', type: 'team', name: 'engenharia' }] },
      '/v1/teams/name/engenharia': { name: 'engenharia', defaultRoles: [], parents: [] },
      '/v1/roles/name/PIIViewer': { name: 'PIIViewer', policies: [{ id: 'p1', type: 'policy', name: 'TeamPolicy' }] },
      '/v1/policies/name/TeamPolicy': {
        rules: [{ name: 'AllowTeam', resources: ['table'], operations: ['ViewAll'], effect: 'allow', condition: "inAnyTeam('engenharia')" }],
      },
    })
    const adapter = new OpenMetadataAdapter(fakeConfig())

    const level = await adapter.getUserAccessLevel('steward', PII_TABLE.fullyQualifiedName)

    expect(level).toBe('full')
  })

  it('backlog identidade — inAnyTeam(): não concede quando o usuário não está sob nenhum dos times citados', async () => {
    mockFetch({
      '/v1/tables/name/': PII_TABLE,
      '/v1/users/name/': { domains: [{ name: 'vendas' }], roles: [PII_VIEWER_ROLE], teams: [{ id: 't1', type: 'team', name: 'squad-dados' }] },
      '/v1/teams/name/squad-dados': { name: 'squad-dados', defaultRoles: [], parents: [] },
      '/v1/roles/name/PIIViewer': { name: 'PIIViewer', policies: [{ id: 'p1', type: 'policy', name: 'TeamPolicy' }] },
      '/v1/policies/name/TeamPolicy': {
        rules: [{ name: 'AllowTeam', resources: ['table'], operations: ['ViewAll'], effect: 'allow', condition: "inAnyTeam('marketing')" }],
      },
    })
    const adapter = new OpenMetadataAdapter(fakeConfig())

    const level = await adapter.getUserAccessLevel('steward', PII_TABLE.fullyQualifiedName)

    expect(level).toBe('read')
  })

  it('backlog identidade — hasDomain(): concede sempre neste ponto do fluxo (gate de domínio já passou antes)', async () => {
    mockFetch({
      '/v1/tables/name/': PII_TABLE,
      '/v1/users/name/': { domains: [{ name: 'vendas' }], roles: [PII_VIEWER_ROLE] },
      '/v1/roles/name/PIIViewer': { name: 'PIIViewer', policies: [{ id: 'p1', type: 'policy', name: 'DomainPolicy' }] },
      '/v1/policies/name/DomainPolicy': {
        rules: [{ name: 'AllowDomain', resources: ['table'], operations: ['ViewAll'], effect: 'allow', condition: 'hasDomain()' }],
      },
    })
    const adapter = new OpenMetadataAdapter(fakeConfig())

    const level = await adapter.getUserAccessLevel('steward', PII_TABLE.fullyQualifiedName)

    expect(level).toBe('full')
  })

  it('backlog identidade — matchTeam(): reconhecida mas fica fail-closed de propósito (precisa de contexto de anexação de policy não modelado)', async () => {
    mockFetch({
      '/v1/tables/name/': PII_TABLE,
      '/v1/users/name/': { domains: [{ name: 'vendas' }], roles: [PII_VIEWER_ROLE] },
      '/v1/roles/name/PIIViewer': { name: 'PIIViewer', policies: [{ id: 'p1', type: 'policy', name: 'TeamAttachPolicy' }] },
      '/v1/policies/name/TeamAttachPolicy': {
        rules: [{ name: 'AllowMatchTeam', resources: ['table'], operations: ['ViewAll'], effect: 'allow', condition: 'matchTeam()' }],
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
