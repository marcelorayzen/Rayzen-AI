import { BadRequestException } from '@nestjs/common'
import { SkillEngineService } from '../skill-engine.service'
import { SkillDefinition } from '../skill-registry'

/**
 * ── A08: autorização não pode mudar conforme a porta de entrada ──────────────
 *
 * A auditoria de 13/09 registrou: *"aprovação e IDs não têm contrato uniforme; acesso direto sem
 * missão contorna gate de skill"*. O mecanismo estava em uma linha — o gate de risco medium/high
 * só era avaliado quando `req.missionId && req.stepId` estavam presentes, e `missionId` é um campo
 * que **o chamador preenche**.
 *
 * Dos quatro chamadores de `run()`, dois nunca o preenchem:
 *
 * | chamador | manda missionId? | consequência antes |
 * |---|---|---|
 * | `StepExecutorService` | sim | gate avaliado |
 * | `WorkflowEngineService` | sim | gate avaliado |
 * | `POST /v2/skills/run` | opcional no DTO | **sem gate** |
 * | `RouterService.executeSkill` | nunca | **sem gate** |
 *
 * Pelas duas últimas passavam as quatro skills `high` do registro — `jarvis:file_delete`,
 * `jarvis:send_email`, `jarvis:prisma_migrate`, `guardian:override` — enquanto a MESMA skill,
 * pedida por dentro de uma missão, parava para aprovação.
 *
 * Isso importa mais a cada entrada nova. Um HUB que fale com a plataforma por outro caminho
 * herdaria a autorização da rota que escolheu, não a do que pediu.
 */
describe('SkillEngine — o gate depende do risco, não de quem chamou', () => {
  function skill(risk: SkillDefinition['risk']): SkillDefinition {
    return {
      id: 'jarvis:file_delete', name: 'File Delete', description: 'apaga arquivo',
      category: 'filesystem', risk, runtime: 'agent-desktop', version: '1.0',
      inputSchema: {}, outputSchema: {},
    }
  }

  function montar(risk: SkillDefinition['risk']) {
    const gates = {
      checkAndCreate: jest.fn().mockResolvedValue({
        required: true,
        gate: { id: 'gate-1', status: 'pending' },
      }),
    }
    const registry = {
      resolve:  jest.fn().mockResolvedValue(skill(risk)),
      logUsage: jest.fn().mockResolvedValue(undefined),
    }
    const service = new SkillEngineService(gates as never, registry as never, {} as never)
    return { service, gates }
  }

  it('pedido DIRETO (sem missão) de skill high para no gate', async () => {
    const { service, gates } = montar('high')

    const r = await service.run({ skillId: 'jarvis:file_delete', input: {}, projectId: 'p1' })

    expect(gates.checkAndCreate).toHaveBeenCalled()
    expect(r.success).toBe(false)
    expect(r.output).toMatchObject({ status: 'pending_approval', gateId: 'gate-1' })
  })

  it('pedido DIRETO de skill medium também para no gate', async () => {
    const { service, gates } = montar('medium')

    const r = await service.run({ skillId: 'jarvis:file_delete', input: {}, projectId: 'p1' })

    expect(gates.checkAndCreate).toHaveBeenCalled()
    expect(r.output).toMatchObject({ status: 'pending_approval' })
  })

  /**
   * O gate precisa de escopo para existir. Sem `projectId` a resposta certa é recusar dizendo o
   * que falta — nunca executar por não saber a quem perguntar.
   */
  it('sem projectId, recusa em vez de executar', async () => {
    const { service } = montar('high')

    await expect(service.run({ skillId: 'jarvis:file_delete', input: {} }))
      .rejects.toThrow(BadRequestException)
  })

  it('missionId e stepId chegam como null quando não há missão', async () => {
    const { service, gates } = montar('high')

    await service.run({ skillId: 'jarvis:file_delete', input: {}, projectId: 'p1' })

    const [risco, projectId, missionId, stepId] = gates.checkAndCreate.mock.calls[0]
    expect({ risco, projectId, missionId, stepId })
      .toEqual({ risco: 'high', projectId: 'p1', missionId: null, stepId: null })
  })

  /**
   * `dryRun` continua atravessando: ele existe justamente para ver o que aconteceria sem
   * que nada aconteça. Exigir aprovação para uma prévia treinaria a aprovar sem ler.
   */
  it('dryRun não cria gate', async () => {
    const { service, gates } = montar('high')

    const r = await service.run({ skillId: 'jarvis:file_delete', input: {}, projectId: 'p1', dryRun: true })

    expect(gates.checkAndCreate).not.toHaveBeenCalled()
    expect(r.success).toBe(true)
    expect(r.output).toMatchObject({ dryRun: true })
  })

  /**
   * A isenção descoberta ao fechar o A08. Sem ela, aprovar exige aprovação — e o teste que
   * pegou isso foi um dos três specs que já existiam, não um novo.
   */
  it.each(['guardian:approve_review', 'guardian:reject_review', 'guardian:override'])(
    '%s não é gated: ela É o ato de aprovar',
    async (id) => {
      const gates = {
        checkAndCreate: jest.fn(),
        approve: jest.fn().mockResolvedValue({ id: 'gate-1', status: 'approved' }),
        reject:  jest.fn().mockResolvedValue({ id: 'gate-1', status: 'rejected' }),
      }
      const definicao: SkillDefinition = {
        ...skill(id === 'guardian:override' ? 'high' : 'medium'),
        id, runtime: 'in-process', category: 'guardian',
      }
      const registry = {
        resolve:  jest.fn().mockResolvedValue(definicao),
        logUsage: jest.fn().mockResolvedValue(undefined),
      }
      const guardian = { override: jest.fn().mockResolvedValue({ id: 'r1' }) }
      const service = new SkillEngineService(gates as never, registry as never, guardian as never)

      const r = await service.run({ skillId: id, input: { gateId: 'g1', reportId: 'r1', reason: 'x' } })

      expect(gates.checkAndCreate).not.toHaveBeenCalled()
      expect(r.success).toBe(true)
    },
  )

  it('risco low segue sem gate, como antes', async () => {
    const { service, gates } = montar('low')
    // Sem isto o teste sai da máquina de verdade: risco low atravessa para `dispatchToAgent`,
    // que faz `fetch` no agent-bridge da V1. Teste unitário que abre socket é teste que falha
    // por causa da rede de quem o roda.
    const original = global.fetch
    global.fetch = jest.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => ({ result: {} }), text: async () => '{}',
    }) as never

    try {
      await service.run({ skillId: 'jarvis:file_delete', input: {}, projectId: 'p1' })
      expect(gates.checkAndCreate).not.toHaveBeenCalled()
    } finally {
      global.fetch = original
    }
  })
})
