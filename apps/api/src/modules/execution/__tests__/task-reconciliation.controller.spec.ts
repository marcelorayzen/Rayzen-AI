import { ConflictException, UnauthorizedException } from '@nestjs/common'
import { ApprovalTokenGuard } from '../approval-token.guard'
import { TaskReconciliationController } from '../task-reconciliation.controller'

describe('TaskReconciliationController — autoridade e auditoria humanas', () => {
  const guards = Reflect.getMetadata('__guards__', TaskReconciliationController) ?? []
  const principal = { id: 'approval-token:abc123', type: 'approval_token' as const }
  const task = {
    id: 'task-1', module: 'jarvis', action: 'send_email', payload: {},
    status: 'failed_safe', targetRole: 'desktop', createdAt: '', updatedAt: '',
  }

  function build(result: 'updated' | 'already_applied' | 'stale' = 'updated') {
    const tasks = {
      getEffectUnknown: jest.fn().mockResolvedValue([]),
      reconcileEffectUnknown: jest.fn().mockResolvedValue({ result, task }),
    }
    const audit = { create: jest.fn().mockResolvedValue({ id: 'audit-1' }) }
    return {
      tasks,
      audit,
      ctrl: new TaskReconciliationController(tasks as never, audit as never),
    }
  }

  it('toda a superfície usa APPROVAL_TOKEN e é pública apenas para desligar o JWT global', () => {
    expect(Reflect.getMetadata('isPublic', TaskReconciliationController)).toBe(true)
    expect(guards).toContain(ApprovalTokenGuard)
  })

  it('fecha listagem e resolução se o guard não derivar um principal', async () => {
    const { ctrl } = build()
    expect(() => ctrl.list({}, undefined)).toThrow(UnauthorizedException)
    await expect(ctrl.reconcile('task-1', {
      outcome: 'effect_not_observed', reason: 'verificado',
    }, {})).rejects.toThrow(UnauthorizedException)
  })

  it('usa o ator autenticado, grava auditoria e devolve o estado final', async () => {
    const { ctrl, tasks, audit } = build()
    const dto = {
      outcome: 'effect_not_observed' as const,
      reason: 'Não existe registro externo.',
      evidence: { query: 'provider-id:123' },
    }

    const response = await ctrl.reconcile('task-1', dto, { principal })

    expect(tasks.reconcileEffectUnknown).toHaveBeenCalledWith('task-1', {
      ...dto, actor: principal.id, actorType: principal.type,
    })
    expect(audit.create).toHaveBeenCalledWith(expect.objectContaining({
      taskId: 'task-1',
      actor: principal.id,
      action: 'send_email:reconcile_effect_unknown',
      status: 'success',
    }))
    expect(response).toEqual({ ok: true, replayed: false, task })
  })

  it('retry idêntico não duplica o log de auditoria', async () => {
    const { ctrl, audit } = build('already_applied')

    const response = await ctrl.reconcile('task-1', {
      outcome: 'effect_not_observed', reason: 'verificado',
    }, { principal })

    expect(response.replayed).toBe(true)
    expect(audit.create).not.toHaveBeenCalled()
  })

  it('resolução concorrente ou diferente responde conflito', async () => {
    const { ctrl } = build('stale')
    await expect(ctrl.reconcile('task-1', {
      outcome: 'effect_confirmed', reason: 'confirmado',
    }, { principal })).rejects.toThrow(ConflictException)
  })
})
