import { SpecialistService } from '../specialist.service'

/**
 * Tool-use real para executor "ai".
 * Antes desta correção, SpecialistService.runLoop() só gerava texto via LLM e nunca
 * chamava SkillEngine — uma missão podia terminar "done" sem nenhuma ação real ter
 * ocorrido (descoberto rodando a primeira missão real via POST /v2/route: a missão
 * concluiu com síntese, mas nenhum arquivo foi de fato alterado). Estes testes fixam
 * o comportamento novo: quando o LLM responde com tool_calls, o specialist despacha
 * via SkillEngine.run() antes de considerar o trabalho concluído.
 */
describe('SpecialistService — tool-use real', () => {
  function buildService(opts: {
    completeResponses: Array<{ content: string; toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }> }>
    skillRunResult?: { success: boolean; output: Record<string, unknown> }
  }) {
    let call = 0
    const aiRouter = {
      complete: jest.fn().mockImplementation(async () => {
        const r = opts.completeResponses[Math.min(call, opts.completeResponses.length - 1)]
        call++
        return { ...r, modelUsed: 'gpt-4o', tier: 3, tokensIn: 10, tokensOut: 10, costUsd: 0.001, durationMs: 5, retries: 0 }
      }),
    }
    const ctxEngine = { build: jest.fn().mockResolvedValue({ text: '' }) }
    const costs = {
      canSpend: jest.fn().mockResolvedValue({ allowed: true }),
      record:   jest.fn().mockResolvedValue({}),
    }
    const gates = { checkAndCreate: jest.fn() }
    const skillEngine = {
      run: jest.fn().mockResolvedValue({
        skillId: 'jarvis:file_write', success: true, durationMs: 5, logs: [],
        output: opts.skillRunResult?.output ?? { bytes: 42 },
        ...(opts.skillRunResult ?? {}),
      }),
    }

    const service = new SpecialistService(
      aiRouter as never, ctxEngine as never, costs as never, gates as never, skillEngine as never,
    )
    return { service, aiRouter, skillEngine }
  }

  it('despacha tool_calls via SkillEngine antes de concluir', async () => {
    const { service, aiRouter, skillEngine } = buildService({
      completeResponses: [
        { content: '', toolCalls: [{ id: 'call1', name: 'jarvis:file_write', arguments: { path: 'x.ts', content: 'export const x = 1' } }] },
        { content: 'DONE — file written successfully' },
      ],
    })

    const inst = await service.spawnAndWait({
      type: 'coder', task: 'edit a file', missionId: 'm1', stepId: 's1', projectId: 'p1',
    })

    expect(skillEngine.run).toHaveBeenCalledTimes(1)
    expect(skillEngine.run).toHaveBeenCalledWith({
      skillId: 'jarvis:file_write',
      input: { path: 'x.ts', content: 'export const x = 1' },
      projectId: 'p1', missionId: 'm1', stepId: 's1',
    })
    expect(aiRouter.complete).toHaveBeenCalledTimes(2)
    expect(inst.status).toBe('done')
    expect(inst.output?.actionsExecuted).toEqual([{ skillId: 'jarvis:file_write', success: true }])
  })

  it('continua narrativo (sem tool_calls) quando o LLM não pede nenhuma ação', async () => {
    const { service, skillEngine } = buildService({
      completeResponses: [{ content: 'DONE — nothing to do here' }],
    })

    const inst = await service.spawnAndWait({
      type: 'reviewer', task: 'review something trivial', missionId: 'm1', stepId: 's1', projectId: 'p1',
    })

    expect(skillEngine.run).not.toHaveBeenCalled()
    expect(inst.status).toBe('done')
    expect(inst.output?.actionsExecuted).toBeUndefined()
  })

  it('registra falha do skill mas continua o loop em vez de quebrar o specialist', async () => {
    const aiRouter = {
      complete: jest.fn()
        .mockResolvedValueOnce({
          content: '', toolCalls: [{ id: 'call1', name: 'jarvis:file_write', arguments: { path: 'x.ts' } }],
          modelUsed: 'gpt-4o', tier: 3, tokensIn: 10, tokensOut: 10, costUsd: 0.001, durationMs: 5, retries: 0,
        })
        .mockResolvedValueOnce({
          content: 'DONE — handled the error', modelUsed: 'gpt-4o', tier: 3,
          tokensIn: 10, tokensOut: 10, costUsd: 0.001, durationMs: 5, retries: 0,
        }),
    }
    const ctxEngine = { build: jest.fn().mockResolvedValue({ text: '' }) }
    const costs = { canSpend: jest.fn().mockResolvedValue({ allowed: true }), record: jest.fn().mockResolvedValue({}) }
    const gates = { checkAndCreate: jest.fn() }
    const skillEngine = { run: jest.fn().mockRejectedValue(new Error('Skill not found or disabled')) }

    const service = new SpecialistService(
      aiRouter as never, ctxEngine as never, costs as never, gates as never, skillEngine as never,
    )

    const inst = await service.spawnAndWait({
      type: 'coder', task: 'edit a file', missionId: 'm1', stepId: 's1', projectId: 'p1',
    })

    expect(inst.status).toBe('done')
    expect(inst.output?.actionsExecuted).toEqual([{ skillId: 'jarvis:file_write', success: false }])
  })
})
