import { Test, TestingModule } from '@nestjs/testing'
import { getQueueToken } from '@nestjs/bull'
import { AgentBridgeService } from '../agent-bridge.service'

const mockJob = {
  id: 'job-1',
  data: { id: 'task-1', module: 'jarvis', action: 'screenshot', status: 'pending', payload: {}, targetRole: 'desktop', createdAt: '', updatedAt: '' },
  update: jest.fn().mockResolvedValue(undefined),
}

const mockQueue = {
  add: jest.fn().mockResolvedValue(mockJob),
  getJobs: jest.fn().mockResolvedValue([mockJob]),
}

describe('AgentBridgeService', () => {
  let service: AgentBridgeService

  beforeEach(async () => {
    jest.clearAllMocks()
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AgentBridgeService,
        { provide: getQueueToken('agent-tasks'), useValue: mockQueue },
      ],
    }).compile()
    service = module.get<AgentBridgeService>(AgentBridgeService)
  })

  describe('enqueue', () => {
    it('adiciona job à fila com attempts=3 e backoff=5000', async () => {
      const result = await service.enqueue({
        module: 'jarvis',
        action: 'screenshot',
        payload: { label: 'test' },
      })

      expect(result.status).toBe('pending')
      expect(result.module).toBe('jarvis')
      expect(mockQueue.add).toHaveBeenCalledWith(
        'execute',
        expect.objectContaining({ module: 'jarvis', action: 'screenshot', status: 'pending' }),
        expect.objectContaining({ attempts: 3, backoff: 5000 }),
      )
    })

    it('retorna task com id gerado', async () => {
      const result = await service.enqueue({ module: 'jarvis', action: 'notify', payload: {} })
      expect(result.id).toBeDefined()
      expect(typeof result.id).toBe('string')
    })
  })

  describe('getPending', () => {
    it('retorna tasks com status pending', async () => {
      const tasks = await service.getPending()
      expect(tasks).toHaveLength(1)
      expect(tasks[0].status).toBe('pending')
    })

    it('filtra por targetRole quando fornecido', async () => {
      const tasks = await service.getPending('desktop')
      expect(tasks).toHaveLength(1)
    })

    it('filtra fora tasks de outro role', async () => {
      const tasks = await service.getPending('server')
      expect(tasks).toHaveLength(0)
    })
  })

  describe('updateStatus', () => {
    it('atualiza status do job existente', async () => {
      await service.updateStatus('job-1', 'done', { ok: true })
      expect(mockJob.update).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'done' }),
      )
    })

    it('não lança quando job não existe', async () => {
      mockQueue.getJobs.mockResolvedValue([])
      await expect(service.updateStatus('nao-existe', 'done')).resolves.toBeUndefined()
    })
  })
})
