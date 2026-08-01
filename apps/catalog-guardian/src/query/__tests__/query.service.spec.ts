import { QueryService } from '../query.service'
import { CatalogAdapter } from '../../adapters/catalog-adapter.interface'
import { GuardableAsset, GuardedAsset, LineageContext } from '../../permission-guard/permission-guard.service'

// Guardian sinalizou este arquivo como CRITICAL (sem spec) — QueryService
// nunca teve teste próprio (só validação ao vivo contra LLM real nesta
// sessão). Mesmo padrão de fakes de objeto simples já usado no resto do
// app (sync.service.spec.ts, permission-guard.service.spec.ts,
// governance-policy.service.spec.ts) — nunca TestingModule, sempre
// `new QueryService(...)` direto. Único ponto novo: $queryRaw é chamado
// como tagged template (3 tabelas diferentes) — o fake inspeciona o SQL
// literal pra saber qual conjunto de linhas devolver.

function fakePrisma(rows: { assets?: unknown[]; terms?: unknown[]; policies?: unknown[]; substrAssets?: unknown[]; substrTerms?: unknown[] } = {}) {
  const queryRaw = jest.fn(async (strings: TemplateStringsArray) => {
    const sql = strings.join('')
    if (sql.includes('catalog_assets')) return rows.assets ?? []
    if (sql.includes('catalog_glossary_terms')) return rows.terms ?? []
    if (sql.includes('governance_policies')) return rows.policies ?? []
    return []
  })
  const findManyAssets = jest.fn(async () => rows.substrAssets ?? [])
  const findManyTerms = jest.fn(async () => rows.substrTerms ?? [])
  return {
    prisma: {
      $queryRaw: queryRaw,
      catalogAsset: { findMany: findManyAssets },
      catalogGlossaryTerm: { findMany: findManyTerms },
    } as any,
    queryRaw,
    findManyAssets,
    findManyTerms,
  }
}

function fakeAdapter(overrides: Partial<CatalogAdapter> = {}): CatalogAdapter {
  return {
    source: 'openmetadata',
    listAssets: async () => [],
    getLineage: async () => [],
    getUserAccessLevel: async () => 'full',
    getDomainOwner: async () => ({ owner: null }),
    listGlossaryTerms: async () => [],
    listDomains: async () => ['vendas', 'marketing', 'produto', 'financeiro', 'rh'],
    ...overrides,
  }
}

function fakePermissionGuard(overrides: { buildContext?: any; buildLineageContext?: any; getOwnerOnly?: any } = {}) {
  return {
    buildContext:
      overrides.buildContext ??
      jest.fn(async (_userId: string, assets: GuardableAsset[]): Promise<GuardedAsset[]> =>
        assets.map((a) => ({
          externalId: a.externalId,
          name: a.name,
          owner: a.owner,
          accessLevel: 'full',
          restricted: false,
          description: a.description,
          piiFieldsNote: null,
          tags: a.tags,
        })),
      ),
    buildLineageContext: overrides.buildLineageContext ?? jest.fn(async () => new Map<string, LineageContext>()),
    getOwnerOnly:
      overrides.getOwnerOnly ??
      jest.fn(async (asset: GuardableAsset) => ({ externalId: asset.externalId, owner: asset.owner, domain: asset.domain })),
  } as any
}

function fakeRiskScorer(result: Partial<{ score: number; level: string; recommend: string; signals: string[]; reasons: string[] }> = {}) {
  const score = jest.fn(() => ({ score: 0, level: 'low', recommend: 'safe', signals: [], reasons: [], ...result }))
  return { score } as any
}

function fakeReviewGates() {
  const create = jest.fn(async (dto: Record<string, unknown>) => ({ id: 'gate-1', ...dto }))
  return { create } as any
}

function fakeAudit() {
  const record = jest.fn(async () => undefined)
  return { record } as any
}

function fakeLlm(response: string) {
  return { complete: jest.fn(async () => response) } as any
}

function fakeEmbedding(vectorOrError: number[] | Error = [0.1, 0.2, 0.3]) {
  const embed = jest.fn(async () => {
    if (vectorOrError instanceof Error) throw vectorOrError
    return vectorOrError
  })
  return { embed } as any
}

function fakeConfig(dpoContact: string | undefined = undefined) {
  return { get: jest.fn(() => dpoContact) } as any
}

function asset(overrides: Partial<GuardableAsset> = {}): GuardableAsset {
  return {
    externalId: 'db.schema.pedidos',
    name: 'pedidos',
    description: 'Pedidos de venda',
    owner: 'steward',
    domain: 'vendas',
    sensitivity: 'internal',
    containsPII: false,
    piiFields: [],
    tags: [],
    ...overrides,
  }
}

function makeService(opts: {
  prisma?: any
  permissionGuard?: any
  riskScorer?: any
  reviewGates?: any
  audit?: any
  llm?: any
  adapter?: CatalogAdapter
  embedding?: any
  config?: any
} = {}) {
  return new QueryService(
    opts.prisma ?? fakePrisma().prisma,
    opts.permissionGuard ?? fakePermissionGuard(),
    opts.riskScorer ?? fakeRiskScorer(),
    opts.reviewGates ?? fakeReviewGates(),
    opts.audit ?? fakeAudit(),
    opts.llm ?? fakeLlm('[COMPORTAMENTO: responder]\nResposta padrão.'),
    opts.adapter ?? fakeAdapter(),
    opts.embedding ?? fakeEmbedding(),
    opts.config ?? fakeConfig(),
  )
}

describe('QueryService — ask() roteamento', () => {
  it('pergunta com gatilho de ownership vai pra askOwnership, mesmo com gatilho de processo também presente', async () => {
    const adapter = fakeAdapter({ getDomainOwner: jest.fn(async () => ({ owner: 'Maria' })) })
    const { prisma, queryRaw } = fakePrisma()
    const svc = makeService({ prisma, adapter })

    // "encarregado" (ownership) + "quem aprova" (processo) no mesmo texto —
    // ownership é checado primeiro em ask(), então deve vencer. Sem domínio
    // mencionado, askOwnership cai no branch "sem domínio" (findRelevantAssets
    // contra catalog_assets) — se tivesse ido por askProcess, teria
    // consultado governance_policies em vez disso.
    await svc.ask('quem aprova a nomeação do encarregado de dados?', 'geral', 'geral')

    expect(adapter.getDomainOwner).not.toHaveBeenCalled()
    const querySqls = queryRaw.mock.calls.map(([strings]: [TemplateStringsArray]) => strings.join(''))
    expect(querySqls.some((sql: string) => sql.includes('catalog_assets'))).toBe(true)
    expect(querySqls.some((sql: string) => sql.includes('governance_policies'))).toBe(false)
  })

  it('pergunta com gatilho de processo (sem ownership) vai pra askProcess', async () => {
    const { prisma, queryRaw } = fakePrisma({ policies: [] })
    const svc = makeService({ prisma })

    const result = await svc.ask('qual o processo pra cadastrar um novo domínio?', 'geral', 'geral')

    expect(queryRaw).toHaveBeenCalledTimes(1) // só a busca de governance_policies, nunca assets/termos
    expect(result.ativos).toEqual([])
  })

  it('fluxo normal: monta contexto, chama draftAnswer, calcula risco e finaliza sem gate quando seguro', async () => {
    const { prisma } = fakePrisma({ assets: [], terms: [] })
    const llm = fakeLlm('[COMPORTAMENTO: responder]\nA tabela pedidos contém dados de venda.')
    const permissionGuard = fakePermissionGuard({
      buildContext: jest.fn(async () => [
        { externalId: 'db.schema.pedidos', name: 'pedidos', owner: 'steward', accessLevel: 'full', restricted: false, description: 'Pedidos de venda', piiFieldsNote: null, tags: [] },
      ]),
    })
    const riskScorer = fakeRiskScorer({ recommend: 'safe' })
    const reviewGates = fakeReviewGates()
    const audit = fakeAudit()
    const svc = makeService({ prisma, llm, permissionGuard, riskScorer, reviewGates, audit })

    const result = await svc.ask('onde estão os dados de vendas?', 'geral', 'geral')

    expect(result.texto).toBe('A tabela pedidos contém dados de venda.')
    expect(result.ativos).toEqual(['db.schema.pedidos'])
    expect(result.gateRequired).toBe(false)
    expect(result.gateId).toBeNull()
    expect(reviewGates.create).not.toHaveBeenCalled()
    expect(audit.record).toHaveBeenCalledTimes(1)
    expect(riskScorer.score).toHaveBeenCalledWith(expect.objectContaining({ requiresCitation: true, citedAssetsCount: 1 }))
  })

  it('fluxo normal: risco não-safe cria gate e substitui a resposta', async () => {
    const { prisma } = fakePrisma({ assets: [], terms: [] })
    const llm = fakeLlm('[COMPORTAMENTO: responder]\nResposta sensível.')
    const riskScorer = fakeRiskScorer({ recommend: 'review', level: 'medium', score: 30, reasons: ['motivo x'] })
    const reviewGates = fakeReviewGates()
    const svc = makeService({ prisma, llm, riskScorer, reviewGates })

    const result = await svc.ask('essa tabela tem dado sensível?', 'geral', 'geral')

    expect(reviewGates.create).toHaveBeenCalledTimes(1)
    expect(result.gateId).toBe('gate-1')
    expect(result.gateRequired).toBe(true)
    expect(result.texto).toContain('gate gate-1')
    expect(result.texto).not.toBe('Resposta sensível.')
  })
})

describe('QueryService — askOwnership()', () => {
  it('domínio mencionado: só chama getDomainOwner, nunca busca ativo, e nunca cita ativo (OWN-003)', async () => {
    const adapter = fakeAdapter({ getDomainOwner: jest.fn(async () => ({ owner: 'Ana Paula' })) })
    const { prisma, queryRaw } = fakePrisma()
    const llm = fakeLlm('[COMPORTAMENTO: responder]\nO responsável pelo domínio rh é Ana Paula.')
    const svc = makeService({ prisma, adapter, llm })

    const result = await svc.ask('quem é o steward de RH?', 'geral', 'geral')

    expect(adapter.getDomainOwner).toHaveBeenCalledWith('rh')
    expect(queryRaw).not.toHaveBeenCalled()
    expect(result.ativos).toEqual([]) // domínio nunca conta como ativo citado
  })

  it('sem domínio mencionado: busca ativo via findRelevantAssets + getOwnerOnly, cita por nome', async () => {
    const { prisma } = fakePrisma({ assets: [{ external_id: 'db.schema.pedidos', name: 'pedidos', description: null, owner: 'steward', domain: 'vendas', sensitivity: 'internal', contains_pii: false, pii_fields: [], tags: [], score: 0.9 }] })
    const llm = fakeLlm('[COMPORTAMENTO: responder]\nO owner de pedidos é steward.')
    const svc = makeService({ prisma, llm })

    const result = await svc.ask('quem é o owner da tabela de pedidos?', 'geral', 'geral')

    expect(result.ativos).toEqual(['db.schema.pedidos'])
  })

  it('listDomains() falha: cai pro KNOWN_DOMAINS e ainda resolve o domínio', async () => {
    const adapter = fakeAdapter({
      listDomains: jest.fn(async () => {
        throw new Error('rede instável')
      }),
      getDomainOwner: jest.fn(async () => ({ owner: 'Ana Paula' })),
    })
    const svc = makeService({ adapter })

    await svc.ask('quem é o responsável pelo domínio rh?', 'geral', 'geral')

    expect(adapter.getDomainOwner).toHaveBeenCalledWith('rh')
  })
})

describe('QueryService — askProcess()', () => {
  it('política encontrada: citedAssets carrega o topic mesmo sem match textual na resposta', async () => {
    const { prisma } = fakePrisma({
      policies: [{ topic: 'aprovacao_aspect_type', description: 'Comitê de Governança aprova.', document_ref: null, version: null, score: 0.9 }],
    })
    const llm = fakeLlm('[COMPORTAMENTO: responder]\nA aprovação é feita pelo Comitê de Governança de Dados.')
    const riskScorer = fakeRiskScorer()
    const svc = makeService({ prisma, llm, riskScorer })

    const result = await svc.ask('quem aprova a criação de um aspect type?', 'geral', 'geral')

    expect(result.ativos).toEqual(['aprovacao_aspect_type'])
    expect(riskScorer.score).toHaveBeenCalledWith(expect.objectContaining({ requiresCitation: true, citedAssetsCount: 1 }))
  })

  it('nenhuma política encontrada: não cita nada e não exige citação', async () => {
    const { prisma } = fakePrisma({ policies: [] })
    const llm = fakeLlm('[COMPORTAMENTO: recusar]\nNão há processo documentado para isso.')
    const riskScorer = fakeRiskScorer()
    const svc = makeService({ prisma, llm, riskScorer })

    const result = await svc.ask('qual o processo pra deletar uma tabela?', 'geral', 'geral')

    expect(result.ativos).toEqual([])
    expect(riskScorer.score).toHaveBeenCalledWith(expect.objectContaining({ requiresCitation: false, citedAssetsCount: 0 }))
  })
})

describe('QueryService — busca semântica com fallback (via ask())', () => {
  it('embedding funciona: mapeia linhas do banco incluindo tags', async () => {
    const { prisma } = fakePrisma({
      assets: [{ external_id: 'db.schema.clientes', name: 'clientes', description: 'Cadastro', owner: null, domain: 'vendas', sensitivity: 'restricted', contains_pii: true, pii_fields: ['cpf'], tags: ['Tier.Tier1'], score: 0.8 }],
    })
    const permissionGuard = fakePermissionGuard()
    const svc = makeService({ prisma, permissionGuard })

    await svc.ask('quem cuida dos dados de clientes?', 'geral', 'geral')

    expect(permissionGuard.buildContext).toHaveBeenCalledWith(
      'geral',
      expect.arrayContaining([expect.objectContaining({ externalId: 'db.schema.clientes', tags: ['Tier.Tier1'] })]),
    )
  })

  it('embedding falha: cai pro fallback de substring', async () => {
    const { prisma, findManyAssets } = fakePrisma({ substrAssets: [asset({ externalId: 'db.schema.pedidos', name: 'pedidos' })] })
    const embedding = fakeEmbedding(new Error('Jina fora do ar'))
    const svc = makeService({ prisma, embedding })

    await svc.ask('pedidos de venda', 'geral', 'geral')

    expect(findManyAssets).toHaveBeenCalled()
  })

  it('fallback de termos de glossário aceita sigla de 3 letras (minLength=3) — regressão do bug real do backlog "busca por glossário"', async () => {
    const { prisma, findManyTerms } = fakePrisma({
      substrTerms: [{ externalId: 'termos.pmr', name: 'pmr', displayName: 'PMR', description: 'Prazo Médio de Recebimento' }],
    })
    const embedding = fakeEmbedding(new Error('sem Jina'))
    const svc: any = makeService({ prisma, embedding })

    const terms = await svc.findRelevantGlossaryTerms('o que significa PMR?')

    expect(findManyTerms).toHaveBeenCalled()
    // com minLength=4 (default de findRelevantAssets), "pmr" (3 letras)
    // seria descartado antes de comparar — o fallback de termos usa 3.
    expect(terms).toEqual([expect.objectContaining({ externalId: 'termos.pmr' })])
  })

  it('governance policy: LIMIT 1, sem fallback — falha de embedding retorna null', async () => {
    const svc: any = makeService({ embedding: fakeEmbedding(new Error('sem Jina')) })
    const policy = await svc.findRelevantGovernancePolicy('qual o processo de acesso?')
    expect(policy).toBeNull()
  })
})

describe('QueryService — draftAnswer() construção do prompt (via ask())', () => {
  it('tags LegalBasis.* ficam fora do bloco de qualidade mas aparecem no bloco de base legal dedicado', async () => {
    const { prisma } = fakePrisma({ assets: [] })
    const llm = fakeLlm('[COMPORTAMENTO: responder]\nOk.')
    const permissionGuard = fakePermissionGuard({
      buildContext: jest.fn(async () => [
        { externalId: 'db.schema.clientes', name: 'clientes', owner: 'steward', accessLevel: 'full', restricted: false, description: 'Cadastro', piiFieldsNote: null, tags: ['Certification.Gold', 'LegalBasis.Consentimento'] },
      ]),
    })
    const svc = makeService({ prisma, llm, permissionGuard })

    await svc.ask('a base de clientes é confiável?', 'geral', 'geral')

    const userPrompt = llm.complete.mock.calls[0][1] as string
    expect(userPrompt).toContain('[tags: Certification.Gold]') // sem LegalBasis aqui
    expect(userPrompt).toContain('Base legal registrada (LGPD):')
    expect(userPrompt).toContain('- clientes: Consentimento')
  })

  it('ativo restrito mostra piiFieldsNote em vez de descrição', async () => {
    const { prisma } = fakePrisma({ assets: [] })
    const llm = fakeLlm('[COMPORTAMENTO: responder]\nOk.')
    const permissionGuard = fakePermissionGuard({
      buildContext: jest.fn(async () => [
        { externalId: 'db.schema.clientes', name: 'clientes', owner: 'steward', accessLevel: 'read', restricted: true, description: null, piiFieldsNote: '[RESTRITO: nível read — campos PII omitidos: cpf]', tags: [] },
      ]),
    })
    const svc = makeService({ prisma, llm, permissionGuard })

    await svc.ask('a base de clientes tem PII?', 'geral', 'geral')

    const userPrompt = llm.complete.mock.calls[0][1] as string
    expect(userPrompt).toContain('[RESTRITO: nível read — campos PII omitidos: cpf]')
    expect(userPrompt).not.toContain('sem descrição')
  })

  it('bloco de linhagem mostra vizinhos visíveis e contagem oculta', async () => {
    const { prisma } = fakePrisma({ assets: [] })
    const llm = fakeLlm('[COMPORTAMENTO: responder]\nOk.')
    const permissionGuard = fakePermissionGuard({
      buildContext: jest.fn(async () => [
        { externalId: 'db.schema.pedidos', name: 'pedidos', owner: 'steward', accessLevel: 'full', restricted: false, description: 'Pedidos', piiFieldsNote: null, tags: [] },
      ]),
      buildLineageContext: jest.fn(
        async () => new Map([['db.schema.pedidos', { upstreamNames: ['estoque'], upstreamHiddenCount: 0, downstreamNames: [], downstreamHiddenCount: 2 }]]),
      ),
    })
    const svc = makeService({ prisma, llm, permissionGuard })

    await svc.ask('de onde vem a tabela pedidos?', 'geral', 'geral')

    const userPrompt = llm.complete.mock.calls[0][1] as string
    expect(userPrompt).toContain('vem de estoque')
    expect(userPrompt).toContain('2 consumidor(es) fora do seu domínio (nome omitido)')
  })
})

describe('QueryService — dpoContactLine()', () => {
  it('contato configurado: inclui o valor', () => {
    const svc: any = makeService({ config: fakeConfig('dpo@empresa.com') })
    expect(svc.dpoContactLine()).toContain('dpo@empresa.com')
  })

  it('sem contato configurado: orienta a consultar compliance/jurídico', () => {
    const svc: any = makeService({ config: fakeConfig(undefined) })
    expect(svc.dpoContactLine()).toContain('Não há contato de encarregado de dados (DPO) configurado')
  })
})

describe('QueryService — parseBehaviorTag()', () => {
  it.each(['responder', 'recusar', 'esclarecer', 'parcial'])('reconhece a tag [COMPORTAMENTO: %s] e remove do texto', (tag) => {
    const svc: any = makeService()
    const result = svc.parseBehaviorTag(`[COMPORTAMENTO: ${tag}]\nTexto da resposta.`)
    expect(result.behavior).toBe(tag)
    expect(result.answer).toBe('Texto da resposta.')
  })

  it('sem tag reconhecível: assume "responder" e mantém o texto inteiro', () => {
    const svc: any = makeService()
    const result = svc.parseBehaviorTag('Resposta sem tag nenhuma.')
    expect(result.behavior).toBe('responder')
    expect(result.answer).toBe('Resposta sem tag nenhuma.')
  })
})
