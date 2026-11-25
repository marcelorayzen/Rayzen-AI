import type { HubEvent, HubThread, HubTurn, HubTurnInput, HubWorkItem } from '@rayzen/types'

/**
 * H0: estes são contratos de fronteira, não testes de uma rota futura.
 *
 * O Hub ainda não está implementado; por isso o teste trava a forma que H1/H2
 * terão de respeitar sem fingir que uma API inexistente já foi exercitada.
 */
describe('Rayzen Hub H0 — contratos de fronteira', () => {
  it('não permite que o browser forneça principal, escopo, thread ou sessão Hermes ao enviar um turno', () => {
    const input: HubTurnInput = { idempotencyKey: 'retry-safe-key', text: 'olá' }

    expect(Object.keys(input).sort()).toEqual(['idempotencyKey', 'text'])
    expect(input).not.toHaveProperty('principalId')
    expect(input).not.toHaveProperty('projectId')
    expect(input).not.toHaveProperty('threadId')
    expect(input).not.toHaveProperty('hermesSessionId')
  })

  it('amarra os registros persistentes ao contrato versionado e às correlações necessárias', () => {
    const thread: Pick<HubThread, 'contractVersion' | 'principalId' | 'scope' | 'hermesSessionId'> = {
      contractVersion: '2026-10-12', principalId: 'principal-1', scope: { type: 'project', projectId: 'project-1' }, hermesSessionId: 'hermes-1',
    }
    const turn: Pick<HubTurn, 'threadId' | 'idempotencyKey' | 'status' | 'error'> = {
      threadId: 'thread-1', idempotencyKey: 'retry-safe-key', status: 'failed', error: { code: 'runtime_unavailable', message: 'indisponível', retryable: true },
    }
    const event: Pick<HubEvent, 'threadId' | 'turnId' | 'sequence' | 'type'> = {
      threadId: 'thread-1', turnId: 'turn-1', sequence: 1, type: 'turn.failed',
    }
    const work: Pick<HubWorkItem, 'threadId' | 'kind' | 'sourceSystem' | 'sourceId'> = {
      threadId: 'thread-1', kind: 'project_handoff', sourceSystem: 'v1', sourceId: 'handoff-1',
    }

    expect(thread.scope).toEqual({ type: 'project', projectId: 'project-1' })
    expect(turn.error?.retryable).toBe(true)
    expect(event.sequence).toBeGreaterThan(0)
    expect(work.sourceId).toBeTruthy()
  })
})
