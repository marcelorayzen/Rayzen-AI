import { Test, TestingModule } from '@nestjs/testing'
import { getQueueToken } from '@nestjs/bull'
import { AgentBridgeService } from '../agent-bridge.service'
import { PrismaService } from '../../../prisma/prisma.service'

const mockJob = {
  id: 'job-1',
  data: { id: 'task-1', module: 'jarvis', action: 'screenshot', status: 'pending', payload: {}, targetRole: 'desktop', createdAt: '', updatedAt: '' },
  update: jest.fn().mockResolvedValue(undefined),
}

const redisValues = new Map<string, string>()
let fencingSequence = 0
const mockRedis = {
  set: jest.fn(async (key: string, value: string, ...args: unknown[]) => {
    const mode = args.find((arg) => arg === 'NX' || arg === 'XX')
    if (mode === 'NX' && redisValues.has(key)) return null
    if (mode === 'XX' && !redisValues.has(key)) return null
    redisValues.set(key, value)
    return 'OK'
  }),
  get: jest.fn(async (key: string) => redisValues.get(key) ?? null),
  incr: jest.fn(async () => ++fencingSequence),
  eval: jest.fn(async (_script: string, _keys: number, key: string, expected: string) => {
    if (redisValues.get(key) !== expected) return 0
    redisValues.delete(key)
    return 1
  }),
}

const mockQueue = {
  add: jest.fn().mockResolvedValue(mockJob),
  getJobs: jest.fn().mockResolvedValue([mockJob]),
  getJob: jest.fn(async (id: string) => id === mockJob.id ? mockJob : null),
  client: mockRedis,
}

describe('AgentBridgeService', () => {
  let service: AgentBridgeService

  beforeEach(async () => {
    jest.clearAllMocks()
    redisValues.clear()
    fencingSequence = 0
    mockJob.data = { id: 'task-1', module: 'jarvis', action: 'screenshot', status: 'pending', payload: {}, targetRole: 'desktop', createdAt: '', updatedAt: '' }
    mockJob.update.mockImplementation(async (data) => { mockJob.data = data })
    mockQueue.getJobs.mockResolvedValue([mockJob])
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AgentBridgeService,
        { provide: getQueueToken('agent-tasks'), useValue: mockQueue },
        // A sincronizacao do ProjectHandoff (Fase 4) entra pelo ciclo de vida da tarefa. Aqui
        // ela devolve `null`: a MAIORIA das tarefas nao vem de um envelope, e esse e o caminho
        // que estes casos medem — o do envelope tem spec proprio em modules/handoff.
        { provide: PrismaService, useValue: { projectHandoff: { findFirst: jest.fn().mockResolvedValue(null), update: jest.fn() } } },
      ],
    }).compile()
    service = module.get<AgentBridgeService>(AgentBridgeService)
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
      const claimed = await service.claimTask('desktop', 'PC-CASA')
      await service.updateStatus('job-1', 'done', { ok: true }, undefined, 'PC-CASA', claimed?.fencingToken)
      expect(mockJob.update).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'done' }),
      )
    })

    it('não lança quando job não existe', async () => {
      await expect(service.updateStatus('nao-existe', 'done')).resolves.toBe('not_found')
    })
  })
})
