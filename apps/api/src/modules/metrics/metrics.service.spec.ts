import { Test, TestingModule } from '@nestjs/testing'
import { getQueueToken } from '@nestjs/bull'
import { MetricsService } from './metrics.service'
import { PrismaService } from '../../prisma/prisma.service'

const mockQueue = {
  getWaitingCount: jest.fn().mockResolvedValue(2),
  getActiveCount: jest.fn().mockResolvedValue(1),
  getCompletedCount: jest.fn().mockResolvedValue(50),
  getFailedCount: jest.fn().mockResolvedValue(3),
  getDelayedCount: jest.fn().mockResolvedValue(0),
}

const mockPrisma = {
  project: { count: jest.fn().mockResolvedValue(5) },
  event: { count: jest.fn().mockResolvedValue(200) },
  agentAuditLog: { count: jest.fn().mockResolvedValue(80) },
}

describe('MetricsService', () => {
  let service: MetricsService

  beforeEach(async () => {
    jest.clearAllMocks()
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MetricsService,
        { provide: getQueueToken('agent-tasks'), useValue: mockQueue },
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile()
    service = module.get<MetricsService>(MetricsService)
  })

  describe('métricas declaradas', () => {
    it('registra httpRequestDuration histogram', () => {
      expect(service.httpRequestDuration).toBeDefined()
    })

    it('registra llmTokensTotal counter', () => {
      expect(service.llmTokensTotal).toBeDefined()
    })

    it('registra llmRequestDuration histogram', () => {
      expect(service.llmRequestDuration).toBeDefined()
    })

    it('registra agentTasksTotal counter', () => {
      expect(service.agentTasksTotal).toBeDefined()
    })

    it('registra agentTaskDuration histogram', () => {
      expect(service.agentTaskDuration).toBeDefined()
    })
  })

  describe('getMetrics', () => {
    it('chama counts do banco e da fila', async () => {
      await service.getMetrics()
      expect(mockPrisma.project.count).toHaveBeenCalled()
      expect(mockPrisma.event.count).toHaveBeenCalled()
      expect(mockPrisma.agentAuditLog.count).toHaveBeenCalled()
      expect(mockQueue.getWaitingCount).toHaveBeenCalled()
      expect(mockQueue.getActiveCount).toHaveBeenCalled()
    })

    it('retorna string no formato Prometheus', async () => {
      const output = await service.getMetrics()
      expect(typeof output).toBe('string')
      expect(output).toContain('rayzen_')
    })

    it('não lança quando fila está indisponível', async () => {
      mockQueue.getWaitingCount.mockRejectedValue(new Error('Redis down'))
      await expect(service.getMetrics()).resolves.toBeDefined()
    })

    it('não lança quando banco está indisponível', async () => {
      mockPrisma.project.count.mockRejectedValue(new Error('DB down'))
      await expect(service.getMetrics()).resolves.toBeDefined()
    })
  })

  describe('contadores LLM', () => {
    it('inc llmTokensTotal sem lançar', () => {
      expect(() =>
        service.llmTokensTotal.inc({ module: 'orchestrator', model: 'gpt-4o' }, 150),
      ).not.toThrow()
    })

    it('observe llmRequestDuration sem lançar', () => {
      expect(() =>
        service.llmRequestDuration.observe({ module: 'orchestrator', model: 'gpt-4o' }, 1.5),
      ).not.toThrow()
    })
  })

  describe('contadores Agent', () => {
    it('inc agentTasksTotal sem lançar', () => {
      expect(() =>
        service.agentTasksTotal.inc({ action: 'screenshot', status: 'success', role: 'desktop' }),
      ).not.toThrow()
    })

    it('observe agentTaskDuration sem lançar', () => {
      expect(() =>
        service.agentTaskDuration.observe({ action: 'screenshot', risk: 'medium' }, 2.3),
      ).not.toThrow()
    })
  })
})
