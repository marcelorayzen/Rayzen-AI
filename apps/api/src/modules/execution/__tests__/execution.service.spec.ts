import { Test, TestingModule } from '@nestjs/testing'
import { getQueueToken } from '@nestjs/bull'
import { ExecutionService } from '../execution.service'
import { EventService } from '../../event/event.service'

const mockQueue = {
  add: jest.fn(),
  getJobs: jest.fn(),
}

describe('ExecutionService', () => {
  let service: ExecutionService

  beforeEach(async () => {
    jest.clearAllMocks()

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExecutionService,
        {
          provide: getQueueToken('agent-tasks'),
          useValue: mockQueue,
        },
        {
          provide: EventService,
          useValue: { create: jest.fn().mockResolvedValue(undefined) },
        },
      ],
    }).compile()

    service = module.get<ExecutionService>(ExecutionService)
  })

  describe('dispatch', () => {
    it('adiciona o job na fila com os parâmetros corretos', async () => {
      mockQueue.add.mockResolvedValue({})
      mockQueue.getJobs.mockResolvedValue([
        {
          id: expect.any(String),
          data: { status: 'done', result: { ok: true }, module: 'jarvis', action: 'open_app' },
        },
      ])

      mockQueue.getJobs.mockImplementation(async () => {
        const calls = mockQueue.add.mock.calls
        const lastCall = calls[calls.length - 1]
        const jobId = lastCall[2].jobId
        return [{ id: jobId, data: { status: 'done', result: { app: 'chrome' } } }]
      })

      await service.dispatch('open_app', { app: 'chrome' })

      expect(mockQueue.add).toHaveBeenCalledWith(
        'execute',
        expect.objectContaining({
          module: 'jarvis',
          action: 'open_app',
          payload: { app: 'chrome' },
          status: 'pending',
        }),
        expect.objectContaining({
          attempts: 3,
          backoff: 5000,
          removeOnComplete: false,
          removeOnFail: false,
        }),
      )
    })

    it('o task criado tem module="jarvis" independente do nome interno do módulo NestJS', async () => {
      mockQueue.add.mockResolvedValue({})
      mockQueue.getJobs.mockImplementation(async () => {
        const calls = mockQueue.add.mock.calls
        const lastCall = calls[calls.length - 1]
        const jobId = lastCall[2].jobId
        return [{ id: jobId, data: { status: 'done', result: {} } }]
      })

      await service.dispatch('list_dir', { path: 'C:\\Downloads' })

      const addCall = mockQueue.add.mock.calls[0]
      expect(addCall[1].module).toBe('jarvis')
    })

    it('rejeita quando o job falha', async () => {
      mockQueue.add.mockResolvedValue({})
      mockQueue.getJobs.mockImplementation(async () => {
        const calls = mockQueue.add.mock.calls
        const lastCall = calls[calls.length - 1]
        const jobId = lastCall[2].jobId
        return [{ id: jobId, data: { status: 'failed', error: 'App não encontrado' } }]
      })

      await expect(service.dispatch('open_app', { app: 'nonexistent' })).rejects.toThrow('App não encontrado')
    })
  })

  describe('waitForResult', () => {
    it('lança timeout quando job não é encontrado na fila', async () => {
      jest.useFakeTimers()
      mockQueue.getJobs.mockResolvedValue([])

      const caught = service.waitForResult('job-inexistente').catch((e: Error) => e)
      await jest.advanceTimersByTimeAsync(31_000)
      const err = await caught

      expect(err).toBeInstanceOf(Error)
      expect((err as Error).message).toContain('Timeout aguardando o PC Agent executar a tarefa')
      jest.useRealTimers()
    })
  })
})
