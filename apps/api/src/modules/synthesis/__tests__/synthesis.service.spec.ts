import { SynthesisService } from '../synthesis.service'

/**
 * goal-2: sem isso, o goal só atualiza quando alguém lembra de chamar
 * POST /goal/propose-progress manualmente — proposeGoalProgress() existia mas
 * não tinha nenhum chamador automático (achado real: nem o checkpoint nem a
 * web UI chamavam). warnPendingGoalProposals() roda a cada checkpoint (Stop
 * automático ou manual) e cria um evento visível — nunca aplica a proposta
 * sozinho, só avisa, pra exigir confirmação humana via toggleCriteria().
 *
 * O evento sozinho não basta: recent_events pega os últimos N eventos sem
 * filtro e qualquer tool-call gera um, então o aviso é engolido pelo ruído
 * em minutos numa sessão ativa — não sobrevive até uma sessão nova. Por isso
 * propostas de alta confiança também entram em nextSteps, a única superfície
 * com garantia de aparecer no "Próximos passos" injetado pelo hook em toda
 * sessão.
 */
describe('SynthesisService.warnPendingGoalProposals', () => {
  function buildService(
    proposeResult: { goalId: string | null; goalTitle: string | null; proposals: Array<{ criteriaId: string; text: string; confidence: 'high' | 'medium' | 'low'; reason: string }> },
    currentNextSteps: Array<{ id: string; title: string }> = [],
  ) {
    const prisma = {}
    const config = { get: jest.fn().mockReturnValue(undefined) }
    const docSvc = {}
    const metrics = {}
    const graphService = { proposeGoalProgress: jest.fn().mockResolvedValue(proposeResult) }
    const eventService = { create: jest.fn().mockResolvedValue({}) }
    const stateService = {
      get: jest.fn().mockResolvedValue({ nextSteps: currentNextSteps }),
      updatePlanning: jest.fn().mockResolvedValue({}),
    }

    const service = new SynthesisService(
      prisma as never, config as never, docSvc as never, metrics as never,
      graphService as never, eventService as never, stateService as never,
    )
    return { service, eventService, graphService, stateService }
  }

  function warn(service: SynthesisService, projectId: string): Promise<void> {
    return (service as unknown as { warnPendingGoalProposals: (p: string) => Promise<void> }).warnPendingGoalProposals(projectId)
  }

  it('cria um evento de aviso (intent idea) quando há propostas, sem alterar o goal', async () => {
    const { service, eventService, graphService } = buildService({
      goalId: 'g1',
      goalTitle: 'Plataforma de dev pessoal',
      proposals: [
        { criteriaId: 'qa-2', text: 'Padrões de flaky indexados', confidence: 'high', reason: 'commit fechou o pipeline' },
      ],
    })

    await warn(service, 'p1')

    expect(graphService.proposeGoalProgress).toHaveBeenCalledWith('p1')
    expect(eventService.create).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'p1',
      source: 'brain',
      type: 'note',
      intent: 'idea',
      metadata: expect.objectContaining({ kind: 'goal_proposal_pending', goalId: 'g1' }),
    }))
    expect(eventService.create.mock.calls[0][0].content).toContain('Padrões de flaky indexados')
  })

  it('não cria evento quando não há propostas', async () => {
    const { service, eventService } = buildService({ goalId: 'g1', goalTitle: 'X', proposals: [] })

    await warn(service, 'p1')

    expect(eventService.create).not.toHaveBeenCalled()
  })

  it('não cria evento quando o projeto não tem goal ativo', async () => {
    const { service, eventService } = buildService({ goalId: null, goalTitle: null, proposals: [] })

    await warn(service, 'p1')

    expect(eventService.create).not.toHaveBeenCalled()
  })

  it('adiciona proposta de alta confiança em nextSteps (visibilidade cross-sessão)', async () => {
    const { service, stateService } = buildService({
      goalId: 'g1',
      goalTitle: 'X',
      proposals: [
        { criteriaId: 'goal-2', text: 'Meta nunca desatualizada', confidence: 'high', reason: 'evidência clara' },
      ],
    })

    await warn(service, 'p1')

    expect(stateService.updatePlanning).toHaveBeenCalledWith('p1', {
      nextSteps: [{ id: 'confirmar-g1-goal-2', title: expect.stringContaining('Meta nunca desatualizada') }],
    })
  })

  it('não duplica o next-step se a mesma proposta já foi avisada num checkpoint anterior', async () => {
    const { service, stateService } = buildService(
      {
        goalId: 'g1',
        goalTitle: 'X',
        proposals: [
          { criteriaId: 'goal-2', text: 'Meta nunca desatualizada', confidence: 'high', reason: 'evidência clara' },
        ],
      },
      [{ id: 'confirmar-g1-goal-2', title: 'Confirmar critério concluído: Meta nunca desatualizada (evidência clara)' }],
    )

    await warn(service, 'p1')

    expect(stateService.updatePlanning).not.toHaveBeenCalled()
  })

  // O id do critério ('b3') só é único dentro de uma meta. Sem o goalId no id do
  // next-step, o resíduo de uma meta já concluída silenciava o critério homônimo da
  // meta ativa — o projeto chegou a ter dois "confirmar b3" de metas distintas.
  it('não confunde o mesmo criteriaId vindo de outra meta', async () => {
    const { service, stateService } = buildService(
      {
        goalId: 'g2',
        goalTitle: 'Meta nova',
        proposals: [
          { criteriaId: 'b3', text: 'Critério da meta nova', confidence: 'high', reason: 'evidência' },
        ],
      },
      [{ id: 'confirmar-g1-b3', title: 'Confirmar critério concluído: Critério da meta antiga (x)' }],
    )

    await warn(service, 'p1')

    expect(stateService.updatePlanning).toHaveBeenCalledWith('p1', {
      nextSteps: [
        { id: 'confirmar-g1-b3', title: 'Confirmar critério concluído: Critério da meta antiga (x)' },
        { id: 'confirmar-g2-b3', title: expect.stringContaining('Critério da meta nova') },
      ],
    })
  })

  it('não adiciona em nextSteps propostas de confiança media/baixa (só o evento)', async () => {
    const { service, stateService, eventService } = buildService({
      goalId: 'g1',
      goalTitle: 'X',
      proposals: [
        { criteriaId: 'cat-2', text: 'Lineage visível', confidence: 'medium', reason: 'indício parcial' },
      ],
    })

    await warn(service, 'p1')

    expect(eventService.create).toHaveBeenCalled()
    expect(stateService.updatePlanning).not.toHaveBeenCalled()
  })

  /**
   * O checkpoint se alimentava da própria saída.
   *
   * `conversation_messages` **não é conversa** — é log de chamada de LLM de todo
   * módulo, e `runSynthesis()` grava o resumo lá com `module: 'synthesis'`. O
   * checkpoint lia a tabela inteira na janela e encontrava o resumo do checkpoint
   * anterior, parafraseando-o para frente.
   *
   * Medido em 2026-08-18 no Rayzen AI: das 3.990 linhas do projeto, **nenhuma** é
   * diálogo de usuário — `documentation` 1.558, `synthesis` 1.103, `project-state`
   * 952. Em ~20h houve **12 checkpoints e 11 resumos praticamente idênticos**,
   * repetindo "Sete commits foram enviados à produção" muito depois de o número ter
   * mudado, e carregando adiante uma deriva que virou fato falso: "iniciando o HUD
   * orbital via WebSocket", quando o HUD foi explicitamente PARADO e nunca começou.
   */
  describe('checkpoint não se alimenta da própria saída', () => {
    /** Captura o `where` usado na busca de mensagens, sem rodar o LLM. */
    async function capturarFiltro(): Promise<Record<string, unknown>> {
      let capturado: Record<string, unknown> = {}
      const prisma = {
        sessionArtifact: { findFirst: jest.fn().mockResolvedValue({ createdAt: new Date('2026-08-18T02:00:00Z') }) },
        event: { findMany: jest.fn().mockResolvedValue([]) },
        conversationMessage: {
          findMany: jest.fn().mockImplementation(({ where }) => { capturado = where; return Promise.resolve([]) }),
        },
      }
      const service = new SynthesisService(
        prisma as never, { get: jest.fn() } as never, {} as never, {} as never,
        {} as never, {} as never, {} as never,
      )

      // Sem evento e sem mensagem, checkpoint() lança antes de chamar o LLM — o que
      // interessa já foi capturado.
      await service.checkpoint('p1').catch(() => null)
      return capturado
    }

    it('exclui o próprio módulo synthesis da janela', async () => {
      const where = await capturarFiltro()
      const excluidos = (where.module as { notIn: string[] })?.notIn ?? []

      expect(excluidos).toContain('synthesis')
    })

    it('exclui também os módulos derivados dos mesmos eventos', async () => {
      // `documentation` e `project-state` são gerados A PARTIR dos mesmos eventos que
      // o checkpoint já lê direto: incluí-los duplica a entrada, e pela versão já
      // resumida por um LLM — que é onde a deriva se acumula.
      const where = await capturarFiltro()
      const excluidos = (where.module as { notIn: string[] })?.notIn ?? []

      expect(excluidos).toEqual(expect.arrayContaining(['documentation', 'project-state']))
    })

    it('usa denylist, não allowlist — diálogo real de um módulo novo continua entrando', async () => {
      const where = await capturarFiltro()

      expect(where.module).toHaveProperty('notIn')
      expect(where.module).not.toHaveProperty('in')
    })

    it('continua limitando a janela ao último checkpoint', async () => {
      const where = await capturarFiltro()

      expect(where.createdAt).toEqual({ gte: new Date('2026-08-18T02:00:00Z') })
    })
  })
})
