import { Test, TestingModule } from '@nestjs/testing'
import { getQueueToken } from '@nestjs/bull'
import { AgentTaskBrokerService, IdempotencyConflictError, canonicalJson } from '../agent-task-broker.service'

describe('AgentTaskBrokerService — criação idempotente', () => {
  let service: AgentTaskBrokerService
  let values: Map<string, string>
  let jobs: Map<string, { id: string; data: unknown }>
  let queue: { client: { set: jest.Mock; get: jest.Mock }; add: jest.Mock; getJob: jest.Mock }

  beforeEach(async () => {
    values = new Map()
    jobs = new Map()
    queue = {
      client: {
        set: jest.fn(async (key: string, value: string, mode: string) => {
          if (mode === 'NX' && values.has(key)) return null
          values.set(key, value)
          return 'OK'
        }),
        get: jest.fn(async (key: string) => values.get(key) ?? null),
      },
      add: jest.fn(async (_name: string, data: { id: string }, options: { jobId: string }) => {
        if (!jobs.has(options.jobId)) jobs.set(options.jobId, { id: options.jobId, data })
        return jobs.get(options.jobId)
      }),
      getJob: jest.fn(async (id: string) => jobs.get(id) ?? null),
    }

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AgentTaskBrokerService,
        { provide: getQueueToken('agent-tasks'), useValue: queue },
      ],
    }).compile()
    service = module.get(AgentTaskBrokerService)
  })

  const request = (payload: Record<string, unknown> = { label: 'janela' }) => ({
    module: 'jarvis' as const,
    action: 'screenshot',
    payload,
    targetRole: 'desktop' as const,
    idempotencyKey: 'proof:screenshot:1',
  })

  it('cria um job determinístico e persiste hash do pedido', async () => {
    const result = await service.enqueue(request())

    expect(result.replayed).toBe(false)
    expect(result.task.id).toMatch(/^idem-[a-f0-9]{64}$/)
    expect(result.task.requestHash).toMatch(/^[a-f0-9]{64}$/)
    expect(queue.add).toHaveBeenCalledTimes(1)
  })

  it('mesma chave e mesmo pedido devolvem o mesmo job sem novo efeito de criação', async () => {
    const first = await service.enqueue(request())
    const replay = await service.enqueue(request())

    expect(replay.replayed).toBe(true)
    expect(replay.task.id).toBe(first.task.id)
    expect(queue.add).toHaveBeenCalledTimes(1)
  })

  it('ordem diferente das chaves do payload preserva o mesmo hash', async () => {
    const first = await service.enqueue(request({ a: 1, nested: { z: true, b: 'x' } }))
    const replay = await service.enqueue(request({ nested: { b: 'x', z: true }, a: 1 }))

    expect(replay.replayed).toBe(true)
    expect(replay.task.requestHash).toBe(first.task.requestHash)
  })

  it('mesma chave com payload diferente falha em conflito e não cria outro job', async () => {
    await service.enqueue(request({ label: 'primeiro' }))

    await expect(service.enqueue(request({ label: 'segundo' })))
      .rejects.toBeInstanceOf(IdempotencyConflictError)
    expect(queue.add).toHaveBeenCalledTimes(1)
  })

  it('mesma chave com atraso diferente é conflito', async () => {
    await service.enqueue(request(), { delayMs: 1_000 })
    await expect(service.enqueue(request(), { delayMs: 2_000 }))
      .rejects.toBeInstanceOf(IdempotencyConflictError)
  })

  it('retry cria a tarefa se o processo caiu antes de o Bull aceitar o job', async () => {
    queue.add.mockRejectedValueOnce(new Error('queda simulada'))
    await expect(service.enqueue(request())).rejects.toThrow('queda simulada')

    const repaired = await service.enqueue(request())
    expect(repaired.replayed).toBe(false)
    expect(await queue.getJob(repaired.task.id)).not.toBeNull()
  })

  it('registro aceito sem job falha fechado em vez de recriar efeito possivelmente executado', async () => {
    const first = await service.enqueue(request())
    jobs.delete(first.task.id)

    await expect(service.enqueue(request())).rejects.toThrow('reconciliacao manual necessaria')
    expect(queue.add).toHaveBeenCalledTimes(1)
  })

  it('duas criações concorrentes da mesma intenção resultam em um job', async () => {
    const [a, b] = await Promise.all([service.enqueue(request()), service.enqueue(request())])

    expect(a.task.id).toBe(b.task.id)
    expect(jobs.size).toBe(1)
    expect([a.replayed, b.replayed].sort()).toEqual([false, true])
  })

  it('canonicalJson segue a semântica de JSON para undefined', () => {
    expect(canonicalJson({ b: undefined, a: [1, undefined] })).toBe('{"a":[1,null]}')
  })
})
