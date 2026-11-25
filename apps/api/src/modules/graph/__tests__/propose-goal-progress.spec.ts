import { GraphService } from '../graph.service'

/**
 * Grounding das propostas de progresso de meta.
 *
 * Achado real (2026-08-07): um checkpoint propôs o critério "criterio 3 verificado:
 * traces dos specialists visiveis no Langfuse" como concluído, com confidence "high",
 * justificando com "[decision] Aprendizado capturado (gotcha): infer() do
 * SpecialistRegistry era só-inglês no branch tester" — um evento sem nenhuma relação
 * com Langfuse. A proposta virou next-step e passou a ser injetada no contexto de toda
 * sessão pelo hook.
 *
 * A saída do LLM era aceita crua: sem conferir se o criteriaId existia, sem exigir
 * evidência, e usando o `text`/`reason` escritos pelo modelo. Aqui o contrato é o
 * inverso — nada entra sem ser verificável contra dados reais.
 */
describe('GraphService.proposeGoalProgress — só aceita proposta verificável', () => {
  const CRITERIA = [
    { id: 'b1', text: 'Missao de 3 steps executa end-to-end sem intervencao manual', done: false },
    { id: 'b3', text: 'criterio 3 verificado: traces dos specialists visiveis no Langfuse', done: false },
    { id: 'b4', text: 'StepExecutorService com cobertura de testes automatizados', done: true },
  ]

  const EVENTS = [
    { content: 'Aprendizado capturado (gotcha): infer() do SpecialistRegistry era so-ingles no branch tester', intent: 'decision', ts: new Date() },
    { content: 'Rodou pnpm test em apps/api-v2 — 174 testes passando', intent: 'execution', ts: new Date() },
  ]

  function buildService(llmResponse: string, events = EVENTS, criteria = CRITERIA) {
    const prisma = {
      projectGoal: {
        findFirst: jest.fn().mockResolvedValue({ id: 'g1', title: 'Fechar o ciclo aberto da V2', successCriteria: criteria }),
      },
      event: { findMany: jest.fn().mockResolvedValue(events) },
    }
    const config = { get: jest.fn().mockReturnValue(undefined) }
    const metrics = {
      llmTokensTotal:      { inc: jest.fn() },
      llmRequestDuration:  { observe: jest.fn() },
    }
    const service = new GraphService(
      prisma as never, {} as never, {} as never, config as never, metrics as never, {} as never,
    )
    const create = jest.fn().mockResolvedValue({
      choices: [{ message: { content: llmResponse } }],
      usage:   { total_tokens: 100 },
    })
    ;(service as unknown as { llm: { chat: { completions: { create: unknown } } } }).llm = {
      chat: { completions: { create } },
    }
    return { service, create, prisma }
  }

  it('descarta a proposta cuja evidência não fala do mesmo assunto que o critério', async () => {
    // Exatamente o falso positivo observado: evento sobre infer()/SpecialistRegistry
    // apontado como prova de que os traces do Langfuse foram verificados.
    const { service } = buildService(JSON.stringify({
      proposals: [{ criteriaId: 'b3', confidence: 'high', evidenceEventIndexes: [0] }],
    }))

    const res = await service.proposeGoalProgress('p1')

    expect(res.proposals).toEqual([])
  })

  it('descarta criteriaId que não existe entre os pendentes (alucinação de id)', async () => {
    const { service } = buildService(JSON.stringify({
      proposals: [{ criteriaId: 'criterio-3', confidence: 'high', evidenceEventIndexes: [0] }],
    }))

    const res = await service.proposeGoalProgress('p1')

    expect(res.proposals).toEqual([])
  })

  it('descarta criteriaId de critério já concluído', async () => {
    const { service } = buildService(JSON.stringify({
      proposals: [{ criteriaId: 'b4', confidence: 'high', evidenceEventIndexes: [1] }],
    }))

    const res = await service.proposeGoalProgress('p1')

    expect(res.proposals).toEqual([])
  })

  it('descarta proposta sem índice de evidência', async () => {
    const { service } = buildService(JSON.stringify({
      proposals: [
        { criteriaId: 'b1', confidence: 'high' },
        { criteriaId: 'b1', confidence: 'high', evidenceEventIndexes: [] },
        { criteriaId: 'b1', confidence: 'high', evidenceEventIndexes: [99] },
        { criteriaId: 'b1', confidence: 'high', evidenceEventIndexes: ['0'] },
      ],
    }))

    const res = await service.proposeGoalProgress('p1')

    expect(res.proposals).toEqual([])
  })

  it('aceita quando o evento citado fala do mesmo assunto do critério', async () => {
    const events = [
      { content: 'Langfuse confirmado: 12 traces de specialists visiveis na missao Stress Test v3', intent: 'decision', ts: new Date() },
    ]
    const { service } = buildService(JSON.stringify({
      proposals: [{ criteriaId: 'b3', confidence: 'high', evidenceEventIndexes: [0] }],
    }), events)

    const res = await service.proposeGoalProgress('p1')

    expect(res.proposals).toHaveLength(1)
    expect(res.proposals[0]).toMatchObject({ criteriaId: 'b3', confidence: 'high' })
  })

  it('usa o texto do critério vindo do banco, e a reason é o evento real — nunca a prosa do LLM', async () => {
    const events = [
      { content: 'Langfuse confirmado: 12 traces de specialists visiveis na missao', intent: 'decision', ts: new Date() },
    ]
    const { service } = buildService(JSON.stringify({
      proposals: [{
        criteriaId: 'b3',
        text: 'TEXTO INVENTADO PELO MODELO',
        reason: 'REASON INVENTADA PELO MODELO',
        confidence: 'high',
        evidenceEventIndexes: [0],
      }],
    }), events)

    const res = await service.proposeGoalProgress('p1')

    expect(res.proposals[0].text).toBe('criterio 3 verificado: traces dos specialists visiveis no Langfuse')
    expect(res.proposals[0].reason).toContain('Langfuse confirmado: 12 traces')
    expect(res.proposals[0].reason).not.toContain('INVENTADA')
  })

  it('descarta quando só um token coincide — um token é coincidência, não evidência', async () => {
    const events = [
      { content: 'Ajuste no Langfuse: subiu a retencao de dados para 30 dias', intent: 'note', ts: new Date() },
    ]
    const { service } = buildService(JSON.stringify({
      proposals: [{ criteriaId: 'b3', confidence: 'high', evidenceEventIndexes: [0] }],
    }), events)

    const res = await service.proposeGoalProgress('p1')

    expect(res.proposals).toEqual([])
  })

  it('descarta o falso positivo real do "project" — vocabulário estrutural não é evidência', async () => {
    // Escapou da primeira versão do gate: o critério cita "project-memory" e o evento
    // era "Bash: Invalidate project state cache". Único elo: a palavra "project".
    const criteria = [{
      id: 'c1',
      text: '6 modulos sem uso congelados em FROZEN.md (scheduler, observability, vault, resource-manager, qa-engine, project-memory)',
      done: false,
    }]
    const events = [{ content: 'Bash: Invalidate project state cache', intent: 'note', ts: new Date() }]
    const { service } = buildService(JSON.stringify({
      proposals: [{ criteriaId: 'c1', confidence: 'medium', evidenceEventIndexes: [0] }],
    }), events, criteria)

    const res = await service.proposeGoalProgress('p1')

    expect(res.proposals).toEqual([])
  })

  it('aceita o verdadeiro positivo com dois tokens fortes em comum', async () => {
    // Contraprova de que o gate não é intransponível: b4 foi de fato concluído, e o
    // evento real compartilha "infer" e "specialistregistry" com o critério.
    const criteria = [{ id: 'b4', text: 'criterio 4 fechado: SpecialistRegistry.infer() com spec', done: false }]
    const events = [{
      content: 'Aprendizado capturado (gotcha): infer() do SpecialistRegistry era so-ingles no branch tester',
      intent: 'decision', ts: new Date(),
    }]
    const { service } = buildService(JSON.stringify({
      proposals: [{ criteriaId: 'b4', confidence: 'high', evidenceEventIndexes: [0] }],
    }), events, criteria)

    const res = await service.proposeGoalProgress('p1')

    expect(res.proposals).toHaveLength(1)
    expect(res.proposals[0].confidence).toBe('high')
  })

  it('não propõe o mesmo critério duas vezes', async () => {
    const events = [
      { content: 'Langfuse confirmado: 12 traces de specialists visiveis na missao', intent: 'decision', ts: new Date() },
    ]
    const { service } = buildService(JSON.stringify({
      proposals: [
        { criteriaId: 'b3', confidence: 'high', evidenceEventIndexes: [0] },
        { criteriaId: 'b3', confidence: 'low',  evidenceEventIndexes: [0] },
      ],
    }), events)

    const res = await service.proposeGoalProgress('p1')

    expect(res.proposals).toHaveLength(1)
  })

  it('sobrevive a JSON quebrado, a proposals ausente e a resposta não-array', async () => {
    for (const bad of ['isso não é json', '{}', '{"proposals":null}', '{"proposals":"x"}', '{"proposals":[null,"x",3]}']) {
      const { service } = buildService(bad)
      const res = await service.proposeGoalProgress('p1')
      expect(res.proposals).toEqual([])
      expect(res.goalId).toBe('g1')
    }
  })

  it('exclui o próprio aviso de proposta do conjunto de evidências', async () => {
    // O loop mais perigoso: warnPendingGoalProposals grava um evento contendo o texto
    // do critério; o ciclo seguinte lia esse evento, achava overlap perfeito e
    // "confirmava" a proposta com a evidência que ele mesmo tinha produzido.
    // Aconteceu em 2026-08-07 às 17:10 com o critério c1, em confidence high.
    const { service, prisma } = buildService(JSON.stringify({ proposals: [] }))

    await service.proposeGoalProgress('p1')

    expect(prisma.event.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          NOT: { metadata: { path: ['kind'], equals: 'goal_proposal_pending' } },
        }),
      }),
    )
  })

  it('indexa os eventos no prompt para o modelo poder citá-los', async () => {
    const { service, create } = buildService(JSON.stringify({ proposals: [] }))

    await service.proposeGoalProgress('p1')

    const prompt = create.mock.calls[0][0].messages[0].content as string
    expect(prompt).toContain('[0] [decision]')
    expect(prompt).toContain('[1] [execution]')
    expect(prompt).toContain('evidenceEventIndexes')
  })

  it('não chama o LLM quando não há critério pendente', async () => {
    const { service, create } = buildService('', EVENTS, [{ id: 'b1', text: 'x', done: true }])

    const res = await service.proposeGoalProgress('p1')

    expect(create).not.toHaveBeenCalled()
    expect(res.proposals).toEqual([])
  })
})
