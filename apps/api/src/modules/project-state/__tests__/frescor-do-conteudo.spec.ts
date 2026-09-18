import { ProjectStateService, Milestone, BacklogItem } from '../project-state.service'

/**
 * `updatedAt` fazia dois trabalhos que se contradizem.
 *
 * Como **marca d'água** do refresh incremental (`ts > updatedAt`) ele precisa avançar em
 * toda escrita, senão o refresh reprocessa evento. Como **sinal de idade** injetado no
 * contexto ele deveria avançar só quando o conteúdo muda. `@updatedAt` do Prisma avança
 * em toda escrita, então a marca d'água ganhava sempre.
 *
 * Medido no Rayzen Commerce Platform em 2026-08-17: o refresh das 04:07 consumiu commits
 * reais e manteve o objetivo de 24/06 byte a byte, zerando o contador. O contexto ficou
 * calado — corretamente, pelas regras antigas — sobre um estado que descrevia outro mês.
 * Pior que a ausência do sinal: a data atestava um frescor que o texto não tinha.
 *
 * O escopo do hash foi MEDIDO sobre os 1.039 refreshes reais, não escolhido:
 *   objetivo ancorado na meta ....  8 mudanças em 84 dias  → 1 a cada ~10 dias  ✅
 *   stage ........................ 92 mudanças em 84 dias  → 1 a cada ~0,9 dia  ❌
 */
describe('ProjectStateService — hash de conteúdo', () => {
  const service = new ProjectStateService(
    {} as never, { get: () => undefined } as never, {} as never,
    {} as never, {} as never, {} as never, {} as never,
  )

  const hash = (objective: string, milestones: Milestone[] = [], backlog: BacklogItem[] = []) =>
    (service as unknown as {
      hashConteudo: (o: string, m: Milestone[], b: BacklogItem[]) => string
    }).hashConteudo(objective, milestones, backlog)

  const ms = (title: string, status: Milestone['status'] = 'pending'): Milestone => ({ id: 'x', title, status })
  const bl = (title: string, priority: BacklogItem['priority'] = 'medium'): BacklogItem => ({ id: 'y', title, priority })

  it('é estável para o mesmo conteúdo', () => {
    expect(hash('Lançar o checkout', [ms('Pagamento')], [bl('Frete')]))
      .toBe(hash('Lançar o checkout', [ms('Pagamento')], [bl('Frete')]))
  })

  it('muda quando o objetivo muda', () => {
    expect(hash('Lançar o checkout')).not.toBe(hash('Lançar o catálogo'))
  })

  it('muda quando um milestone conclui — progresso é mudança de conteúdo', () => {
    expect(hash('Obj', [ms('Pagamento', 'pending')]))
      .not.toBe(hash('Obj', [ms('Pagamento', 'done')]))
  })

  it('NÃO muda por reordenação — trocar dois milestones de lugar não é mudança', () => {
    expect(hash('Obj', [ms('A'), ms('B')])).toBe(hash('Obj', [ms('B'), ms('A')]))
  })

  it('NÃO muda por acento, caixa ou pontuação — titleKey já absorve isso', () => {
    expect(hash('Lançar o checkout!')).toBe(hash('LANCAR O CHECKOUT'))
  })

  it('NÃO muda por prioridade do backlog — é ruído, não descrição', () => {
    expect(hash('Obj', [], [bl('Frete', 'low')])).toBe(hash('Obj', [], [bl('Frete', 'high')]))
  })

  /**
   * Medido: `stage` sozinho respondia por 92 dos 99 movimentos restantes do hash no
   * Rayzen AI, oscilando entre `building` e `stabilizing` sem que nada acontecesse.
   * Se algum dia ele voltar para dentro do digest, este teste cai.
   */
  it('não recebe stage nem activeFocus na assinatura — foram medidos e excluídos', () => {
    const assinatura = (service as unknown as { hashConteudo: (...a: unknown[]) => string }).hashConteudo
    expect(assinatura.length).toBe(3)
  })
})

/**
 * `stage` era o campo mais instável do estado — e por dois motivos independentes.
 *
 * Medido sobre os 939 refreshes reais do Rayzen AI em 84 dias: **92 mudanças de fase**,
 * oscilando entre `building` e `stabilizing` sem evento que justificasse. Sozinho ele
 * respondia por 92 dos 99 movimentos do hash de conteúdo, e foi por isso que ficou
 * fora do digest.
 *
 * A causa não era falta de histerese: o prompt **nunca mostrava a fase atual**. O
 * `ESTADO ATUAL` trazia blockers, nextSteps, decisões, riscos e backlog — o `stage`
 * era re-derivado do zero a cada chamada, sem âncora nenhuma. E o valor voltava CRU
 * para o banco, sem validação contra o enum.
 */
describe('ProjectStateService — estabilidade do stage', () => {
  const montar = (respostaLlm: object, existing: Record<string, unknown> | null = null) => {
    const upsert = jest.fn().mockImplementation(({ create, update }) => ({
      id: 'st1', projectId: 'p1', graphLinks: [], updatedAt: new Date(),
      ...(existing ? update : create),
    }))
    const prisma = {
      project:          { findUnique: jest.fn().mockResolvedValue({ id: 'p1', name: 'Proj', description: null, goals: null }) },
      projectState:     { findUnique: jest.fn().mockResolvedValue(existing), upsert },
      event:            { findMany: jest.fn().mockResolvedValue([]) },
      sessionArtifact:  { findMany: jest.fn().mockResolvedValue([]) },
      projectDocument:  { findMany: jest.fn().mockResolvedValue([]) },
      projectGoal:      { findFirst: jest.fn().mockResolvedValue(null) },
      conversationMessage: { create: jest.fn().mockResolvedValue(null) },
    }
    const service = new ProjectStateService(
      prisma as never, { get: () => undefined } as never,
      { compute: jest.fn().mockResolvedValue(null) } as never,
      { promoteStaleEvents: jest.fn().mockResolvedValue(null) } as never,
      { get: jest.fn(), set: jest.fn(), del: jest.fn() } as never,
      { llmTokensTotal: { inc: jest.fn() }, llmRequestDuration: { observe: jest.fn() } } as never,
      { getConfig: () => ({}) } as never,
    )
    const completions = jest.fn().mockResolvedValue({
      choices: [{ message: { content: JSON.stringify(respostaLlm) } }], usage: { total_tokens: 1 },
    })
    ;(service as unknown as { llm: unknown }).llm = { chat: { completions: { create: completions } } }
    return { service, upsert, completions }
  }

  const resposta = (stage: unknown) => ({
    objective: 'Obj', stage, blockers: [], recentDecisions: [], nextSteps: [], risks: [],
    docGaps: [], riskLevel: 'low', milestones: [], backlog: [], activeFocus: '', definitionOfDone: '',
  })

  const gravado = (stage: string) => ({
    objective: 'Obj', stage, activeFocus: null, updatedAt: new Date('2026-08-16T00:00:00Z'),
    blockers: [], nextSteps: [], recentDecisions: [], risks: [], backlog: [], milestones: [], graphLinks: [],
  })

  it.each(['building|stabilizing', 'em andamento', 'BUILDING agora', ''])(
    'stage inválido (%s) recua para o gravado em vez de ir cru para o banco',
    async (invalido) => {
      const { service, upsert } = montar(resposta(invalido), gravado('stabilizing'))

      await service.refresh('p1')

      expect(upsert.mock.calls[0][0].update.stage).toBe('stabilizing')
    },
  )

  it('sem estado anterior, stage inválido vira building — não a string do LLM', async () => {
    const { service, upsert } = montar(resposta('fase de testes'), null)

    await service.refresh('p1')

    expect(upsert.mock.calls[0][0].create.stage).toBe('building')
  })

  it('stage válido é aceito — o guard não engessa transição real', async () => {
    const { service, upsert } = montar(resposta('maintaining'), gravado('stabilizing'))

    await service.refresh('p1')

    expect(upsert.mock.calls[0][0].update.stage).toBe('maintaining')
  })

  it('o prompt mostra a fase atual — era o que faltava para o modelo poder mantê-la', async () => {
    const { service, completions } = montar(resposta('building'), gravado('stabilizing'))

    await service.refresh('p1')
    const prompt = completions.mock.calls[0][0].messages[0].content

    expect(prompt).toContain('Fase atual (stage): stabilizing')
    expect(prompt).toContain('MANTENHA a fase atual')
    expect(prompt).toContain('Ritmo de trabalho não é mudança de fase')
  })

  it('o prompt enumera as fases válidas, sem placeholder para o modelo copiar', async () => {
    const { service, completions } = montar(resposta('building'), null)

    await service.refresh('p1')
    const prompt = completions.mock.calls[0][0].messages[0].content

    expect(prompt).toContain('discovery | building | stabilizing | maintaining | paused')
  })
})

describe('ProjectStateService — contentChangedAt', () => {
  const montar = (existing: Record<string, unknown> | null, respostaLlm: object) => {
    const upsert = jest.fn().mockImplementation(({ create, update }) => ({
      id: 'st1', projectId: 'p1', graphLinks: [], updatedAt: new Date(),
      ...(existing ? update : create),
    }))

    const prisma = {
      project:          { findUnique: jest.fn().mockResolvedValue({ id: 'p1', name: 'Proj', description: null, goals: null }) },
      projectState:     { findUnique: jest.fn().mockResolvedValue(existing), upsert },
      event:            { findMany: jest.fn().mockResolvedValue([]) },
      sessionArtifact:  { findMany: jest.fn().mockResolvedValue([]) },
      projectDocument:  { findMany: jest.fn().mockResolvedValue([]) },
      projectGoal:      { findFirst: jest.fn().mockResolvedValue(null) },
      conversationMessage: { create: jest.fn().mockResolvedValue(null) },
    }

    const service = new ProjectStateService(
      prisma as never, { get: () => undefined } as never,
      { compute: jest.fn().mockResolvedValue(null) } as never,
      { promoteStaleEvents: jest.fn().mockResolvedValue(null) } as never,
      { get: jest.fn(), set: jest.fn(), del: jest.fn() } as never,
      { llmTokensTotal: { inc: jest.fn() }, llmRequestDuration: { observe: jest.fn() } } as never,
      { getConfig: () => ({}) } as never,
    )
    ;(service as unknown as { llm: unknown }).llm = {
      chat: { completions: { create: jest.fn().mockResolvedValue({
        choices: [{ message: { content: JSON.stringify(respostaLlm) } }], usage: { total_tokens: 1 },
      }) } },
    }
    return { service, upsert }
  }

  const resposta = (objective: string) => ({
    objective, stage: 'building', blockers: [], recentDecisions: [], nextSteps: [],
    risks: [], docGaps: [], riskLevel: 'low', milestones: [], backlog: [],
    activeFocus: '', definitionOfDone: '',
  })

  const estadoGravado = (objective: string, hash: string, quando: Date) => ({
    objective, activeFocus: null, contentHash: hash, contentChangedAt: quando,
    updatedAt: quando, blockers: [], nextSteps: [], recentDecisions: [], risks: [],
    backlog: [], milestones: [], graphLinks: [],
  })

  it('não avança quando o refresh reescreve sem mudar o conteúdo — o caso Commerce', async () => {
    // Descobre o hash que o serviço grava para este conteúdo.
    const primeiro = montar(null, resposta('Lançar o checkout'))
    await primeiro.service.refresh('p1')
    const hashGravado = primeiro.upsert.mock.calls[0][0].create.contentHash as string

    const junho = new Date('2026-06-24T18:05:00Z')
    const { service, upsert } = montar(
      estadoGravado('Lançar o checkout', hashGravado, junho),
      resposta('Lançar o checkout'),
    )

    await service.refresh('p1')

    expect(upsert.mock.calls[0][0].update.contentChangedAt).toEqual(junho)
  })

  it('avança quando o conteúdo muda de verdade', async () => {
    const junho = new Date('2026-06-24T18:05:00Z')
    const { service, upsert } = montar(
      estadoGravado('Lançar o checkout', 'hash-antigo', junho),
      resposta('Lançar o catálogo'),
    )

    await service.refresh('p1')

    expect(upsert.mock.calls[0][0].update.contentChangedAt.getTime()).toBeGreaterThan(junho.getTime())
  })
})

/**
 * Sem backfill, todo projeto nasceria com `contentChangedAt = agora` e o sinal ficaria
 * calado por semanas — inclusive no Commerce, o caso que motivou a coluna.
 */
describe('ProjectStateService — backfill de contentChangedAt', () => {
  const montar = (estado: Record<string, unknown>, historico: Array<{ content: string; createdAt: Date }>) => {
    const update = jest.fn().mockResolvedValue({})
    const prisma = {
      projectState: { findMany: jest.fn().mockResolvedValue([estado]), update },
      conversationMessage: { findMany: jest.fn().mockResolvedValue(historico) },
    }
    const service = new ProjectStateService(
      prisma as never, { get: () => undefined } as never, {} as never,
      {} as never, {} as never, {} as never, {} as never,
    )
    return { service, update }
  }

  const base = {
    projectId: 'p1', objective: 'Lançar o checkout', milestones: [], backlog: [],
    updatedAt: new Date('2026-08-17T04:07:00Z'),
  }
  const msg = (objective: string, createdAt: string) => ({
    content: JSON.stringify({ objective, stage: 'building' }), createdAt: new Date(createdAt),
  })

  it('data pelo refresh mais antigo da série em que o objetivo já era o atual', async () => {
    const { service, update } = montar(base, [
      msg('Lançar o checkout', '2026-08-17T04:07:00Z'),
      msg('Lançar o checkout', '2026-06-24T18:05:00Z'),   // ← início da série
      msg('Desenvolver uma plataforma', '2026-06-11T18:50:00Z'),
      msg('Outra coisa ainda', '2026-06-03T15:37:00Z'),
    ])

    const r = await service.backfillContentChangedAt()

    expect(update.mock.calls[0][0].data.contentChangedAt).toEqual(new Date('2026-06-24T18:05:00Z'))
    expect(r).toEqual({ examinados: 1, datados: 1 })
  })

  /**
   * Regressão medida em produção em 2026-08-17, logo após o primeiro deploy.
   *
   * O Commerce — o caso que motivou a coluna — recebeu `content_changed_at` de HOJE
   * (0 dia) quando a resposta certa era 24/06 (54 dias). Causa: o objetivo dele é
   * derivado de evento, então `textoLimpo` o zera, e um `if (!objetivo) break`
   * confundia "não deu para ler o registro" com "leu, e sobrou vazio" — parava na
   * primeira volta e recuava para `updatedAt`.
   *
   * Vazio é valor comparável como outro qualquer; só extração falha interrompe.
   */
  it('data corretamente quando o objetivo atual é vazio após a limpeza — o caso Commerce', async () => {
    const sujo = 'Desenvolver a plataforma Rayzen Commerce com base nas alterações realizadas nos arquivos orders.ts, package.json e schema.prisma'
    const { service, update } = montar(
      { ...base, objective: sujo },
      [
        msg(sujo, '2026-08-17T04:07:00Z'),
        msg(sujo, '2026-06-24T18:05:00Z'),            // ← início da série
        msg('Desenvolver uma plataforma eficiente', '2026-06-11T18:50:00Z'),
      ],
    )

    await service.backfillContentChangedAt()

    expect(update.mock.calls[0][0].data.contentChangedAt).toEqual(new Date('2026-06-24T18:05:00Z'))
  })

  /**
   * `updatedAt` e a marca d'água do refresh incremental (`ts > updatedAt`) sao a mesma
   * coluna. O `@updatedAt` do Prisma dispara em qualquer update, entao o backfill
   * empurrava o marco para agora e o refresh seguinte **pularia todos os eventos** do
   * intervalo. Observado em produção em 2026-08-17: Rayzen-PDV e Ray coach tiveram
   * `updated_at` de maio sobrescrito para 13:03 pela própria passagem do backfill.
   *
   * Um backfill que existe para datar o passado não pode apagá-lo de passagem.
   */
  it('congela updatedAt — nunca empurra a marca d\'água do refresh incremental', async () => {
    const { service, update } = montar(base, [msg('Lançar o checkout', '2026-06-24T18:05:00Z')])

    await service.backfillContentChangedAt()

    expect(update.mock.calls[0][0].data.updatedAt).toEqual(base.updatedAt)
  })

  it('para a série quando não consegue extrair o objetivo do registro', async () => {
    const { service, update } = montar(base, [
      { content: 'isto não é JSON de refresh', createdAt: new Date('2026-08-01T00:00:00Z') },
    ])

    await service.backfillContentChangedAt()

    expect(update.mock.calls[0][0].data.contentChangedAt).toEqual(base.updatedAt)
  })

  it('recua para updatedAt quando não há histórico', async () => {
    const { service, update } = montar(base, [])

    const r = await service.backfillContentChangedAt()

    expect(update.mock.calls[0][0].data.contentChangedAt).toEqual(base.updatedAt)
    expect(r.datados).toBe(0)
  })

  it('recua para updatedAt quando o objetivo atual não aparece no histórico', async () => {
    // Acontece quando o objetivo passou a vir da meta ativa e nenhum refresh antigo o usou.
    const { service, update } = montar(base, [msg('Outra coisa qualquer', '2026-06-01T00:00:00Z')])

    const r = await service.backfillContentChangedAt()

    expect(update.mock.calls[0][0].data.contentChangedAt).toEqual(base.updatedAt)
    expect(r.datados).toBe(0)
  })

  /**
   * O hash gravado é o EXATO do estado atual, não um parcial reconstruído do histórico
   * truncado — senão o primeiro refresh seguinte veria diferença onde não houve e
   * zeraria justamente a data que o backfill acabou de descobrir.
   */
  it('grava o hash exato do estado atual, não um derivado do histórico', async () => {
    const { service, update } = montar(
      { ...base, milestones: [{ id: 'm1', title: 'Pagamento', status: 'done' }] },
      [msg('Lançar o checkout', '2026-06-24T18:05:00Z')],
    )

    await service.backfillContentChangedAt()
    const hashBackfill = update.mock.calls[0][0].data.contentHash

    const esperado = (service as unknown as {
      hashConteudo: (o: string, m: unknown[], b: unknown[]) => string
    }).hashConteudo('Lançar o checkout', [{ id: 'm1', title: 'Pagamento', status: 'done' }] as never, [])

    expect(hashBackfill).toBe(esperado)
  })
})
