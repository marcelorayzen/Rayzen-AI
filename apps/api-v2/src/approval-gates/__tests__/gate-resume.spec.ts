import { WorkflowEngineService } from '../../workflow/workflow-engine.service'
import { ApprovalGatesController } from '../approval-gates.controller'

/**
 * Fase 2 — gate → resume.
 * Antes da reativação, um ApprovalGate era criado mas nenhum executor o respeitava,
 * e approve() só mudava o status no DB (a missão travava para sempre). Estes testes
 * fixam o comportamento novo: executor pausa no gate, approve re-roda o DAG, reject falha.
 */
describe('Fase 2 — gate → resume', () => {
  describe('WorkflowEngineService respeita ApprovalGates', () => {
    const baseStep = {
      id: 's1', title: 'Risky step', status: 'pending', executor: 'ai',
      skillId: null, prompt: 'do it', input: {}, dependsOn: [], retries: 0,
    }

    function buildEngine(opts: {
      pendingGates?: Array<{ stepId: string | null }>
      spawn?: jest.Mock
      finalSteps?: unknown[]
    }) {
      const steps = [{ ...baseStep }]
      const missions = {
        findOne:    jest.fn().mockResolvedValue({ id: 'm1', status: 'active', projectId: 'p1', objective: 'obj', steps }),
        listSteps:  jest.fn().mockResolvedValue(opts.finalSteps ?? steps),
        updateStep: jest.fn().mockResolvedValue({}),
        transition: jest.fn().mockResolvedValue({}),
      }
      const specialists = { spawn: opts.spawn ?? jest.fn(), getStatus: jest.fn() }
      const specialistAgents = { findById: jest.fn() }
      const skillEngine = { run: jest.fn() }
      const gates         = { findPending: jest.fn().mockResolvedValue(opts.pendingGates ?? []), createClarificationGate: jest.fn() }
      const docs          = { onMissionCompleted: jest.fn().mockResolvedValue([]) }
      const clarification = { checkTask: jest.fn().mockResolvedValue({ needsClarification: false }) }

      const engine = new WorkflowEngineService(
        missions as never, skillEngine as never, {} as never, specialists as never,
        specialistAgents as never, gates as never, docs as never, clarification as never,
      )
      return { engine, missions, specialists }
    }

    it('pausa a missão e NÃO executa o step quando há gate pendente', async () => {
      const spawn = jest.fn()
      const { engine, missions } = buildEngine({ pendingGates: [{ stepId: 's1' }], spawn })

      const stats = await engine.execute('m1', 'p1')

      expect(spawn).not.toHaveBeenCalled()
      expect(missions.transition).toHaveBeenCalledWith('m1', 'paused')
      expect(stats.pending).toBe(1)
    })

    it('executa o step e conclui a missão quando não há gate', async () => {
      const spawn = jest.fn().mockResolvedValue({ id: 'inst1', status: 'done', output: { ok: true }, type: 'coder' })
      const { engine, missions } = buildEngine({
        pendingGates: [],
        spawn,
        finalSteps: [{ ...baseStep, status: 'done' }],
      })

      const stats = await engine.execute('m1', 'p1')

      expect(spawn).toHaveBeenCalledTimes(1)
      expect(missions.transition).toHaveBeenCalledWith('m1', 'done')
      expect(stats.completed).toBe(1)
    })

    it('marca o step como skipped (não done) quando o specialist é interrompido por gate mid-tool-call', async () => {
      // Antes do fix: runStepLogic só checava instance.status === 'failed' — um
      // specialist 'interrupted' (gate criado durante tool-use) caía no caminho de
      // sucesso e o step virava 'done' com um gate pendente órfão (nada foi de
      // fato executado).
      const spawn = jest.fn().mockResolvedValue({
        id: 'inst1', status: 'interrupted', type: 'coder',
        output: { gateId: 'g-mid', message: 'Aguardando aprovação de gate criado durante tool-use' },
      })
      const { engine, missions } = buildEngine({
        pendingGates: [],
        spawn,
        finalSteps: [{ ...baseStep, status: 'skipped' }],
      })

      await engine.execute('m1', 'p1')

      expect(missions.updateStep).toHaveBeenCalledWith('m1', 's1', {
        status: 'skipped',
        output: { gateId: 'g-mid', message: 'Aguardando aprovação de gate criado durante tool-use' },
      })
      expect(missions.updateStep).not.toHaveBeenCalledWith('m1', 's1', expect.objectContaining({ status: 'done' }))
    })
  })

  describe('ApprovalGatesController retoma/encerra a missão', () => {
    it('approve re-roda o DAG quando o gate pertence a uma missão', async () => {
      const gates    = { approve: jest.fn().mockResolvedValue({ id: 'g1', missionId: 'm1', projectId: 'p1', stepId: 's1', status: 'approved' }) }
      const workflow = { execute: jest.fn().mockResolvedValue({}) }
      const missions = { updateStep: jest.fn().mockResolvedValue({}), transition: jest.fn() }
      const events   = { approvalGate: jest.fn() }

      const ctrl = new ApprovalGatesController(gates as never, missions as never, workflow as never, events as never)
      const res = await ctrl.approve('g1', { approvedBy: 'tester' } as never) as { resumed: boolean }

      expect(res.resumed).toBe(true)
      expect(workflow.execute).toHaveBeenCalledWith('m1', 'p1')
    })

    it('approve reabre o step para pending — sem isso um step interrompido mid-tool-call (skipped) nunca é re-escolhido', async () => {
      const gates    = { approve: jest.fn().mockResolvedValue({ id: 'g1', missionId: 'm1', projectId: 'p1', stepId: 's1', status: 'approved' }) }
      const workflow = { execute: jest.fn().mockResolvedValue({}) }
      const missions = { updateStep: jest.fn().mockResolvedValue({}), transition: jest.fn() }
      const events   = { approvalGate: jest.fn() }

      const ctrl = new ApprovalGatesController(gates as never, missions as never, workflow as never, events as never)
      await ctrl.approve('g1', { approvedBy: 'tester' } as never)

      expect(missions.updateStep).toHaveBeenCalledWith('m1', 's1', { status: 'pending' })
    })

    it('reject marca o step como failed e pausa a missão (sem re-rodar)', async () => {
      const gates    = { reject: jest.fn().mockResolvedValue({ id: 'g1', missionId: 'm1', projectId: 'p1', stepId: 's1', status: 'rejected', description: 'desc', type: 'action' }) }
      const workflow = { execute: jest.fn() }
      const missions = { updateStep: jest.fn().mockResolvedValue({}), transition: jest.fn().mockResolvedValue({}) }
      const events   = { approvalGate: jest.fn() }

      const ctrl = new ApprovalGatesController(gates as never, missions as never, workflow as never, events as never)
      await ctrl.reject('g1', { approvedBy: 'tester', comment: 'nope' } as never)

      expect(missions.updateStep).toHaveBeenCalledWith('m1', 's1', expect.objectContaining({ status: 'failed' }))
      expect(missions.transition).toHaveBeenCalledWith('m1', 'paused')
      expect(workflow.execute).not.toHaveBeenCalled()
    })
  })
})
