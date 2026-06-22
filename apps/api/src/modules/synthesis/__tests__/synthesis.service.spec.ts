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
      nextSteps: [{ id: 'confirmar-goal-2', title: expect.stringContaining('Meta nunca desatualizada') }],
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
      [{ id: 'confirmar-goal-2', title: 'Confirmar critério concluído: Meta nunca desatualizada (evidência clara)' }],
    )

    await warn(service, 'p1')

    expect(stateService.updatePlanning).not.toHaveBeenCalled()
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
})
