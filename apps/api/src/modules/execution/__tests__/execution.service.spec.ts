import { Test, TestingModule } from '@nestjs/testing'
import { getQueueToken } from '@nestjs/bull'
import { ExecutionService, papelDaAcao } from '../execution.service'
import { EventService } from '../../event/event.service'
import { AgentHeartbeatService } from '../../agent-bridge/agent-heartbeat.service'
import { AgentTaskBrokerService } from '../../agent-bridge/agent-task-broker.service'

const mockQueue = {
  getJobs: jest.fn(),
}

const mockBroker = {
  newKey: jest.fn().mockReturnValue('execution:auto'),
  enqueue: jest.fn(),
}

const mockEventService = { create: jest.fn().mockResolvedValue(undefined) }

describe('ExecutionService', () => {
  let service: ExecutionService

  beforeEach(async () => {
    jest.clearAllMocks()
    mockEventService.create.mockResolvedValue(undefined)
    mockBroker.newKey.mockReturnValue('execution:auto')
    mockBroker.enqueue.mockImplementation(async (dto: Record<string, unknown>) => ({
      task: {
        id: 'job-1',
        ...dto,
        status: 'pending',
        createdAt: '',
        updatedAt: '',
      },
      replayed: false,
    }))

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExecutionService,
        {
          provide: getQueueToken('agent-tasks'),
          useValue: mockQueue,
        },
        { provide: AgentTaskBrokerService, useValue: mockBroker },
        {
          provide: EventService,
          useValue: mockEventService,
        },
        {
          provide: AgentHeartbeatService,
          // Sempre "online" nestes testes — eles cobrem o comportamento da fila,
          // não a checagem de heartbeat (que tem teste próprio).
          useValue: { isOnline: jest.fn().mockReturnValue(true), getLastSeenAt: jest.fn().mockReturnValue(null) },
        },
      ],
    }).compile()

    service = module.get<ExecutionService>(ExecutionService)
  })

  describe('dispatch', () => {
    it('adiciona o job na fila com os parâmetros corretos', async () => {
      mockQueue.getJobs.mockImplementation(async () => {
        return [{ id: 'job-1', data: { status: 'done', result: { app: 'chrome' } } }]
      })

      await service.dispatch('open_app', { app: 'chrome' })

      expect(mockBroker.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          module: 'jarvis',
          action: 'open_app',
          payload: { app: 'chrome' },
          idempotencyKey: 'execution:auto',
        }),
        { delayMs: undefined },
      )
    })

    it('o task criado tem module="jarvis" independente do nome interno do módulo NestJS', async () => {
      mockQueue.getJobs.mockImplementation(async () => {
        return [{ id: 'job-1', data: { status: 'done', result: {} } }]
      })

      await service.dispatch('list_dir', { path: 'C:\\Downloads' })

      const brokerCall = mockBroker.enqueue.mock.calls[0]
      expect(brokerCall[0].module).toBe('jarvis')
    })

    it('rejeita quando o job falha', async () => {
      mockQueue.getJobs.mockImplementation(async () => {
        return [{ id: 'job-1', data: { status: 'failed', error: 'App não encontrado' } }]
      })

      await expect(service.dispatch('open_app', { app: 'nonexistent' })).rejects.toThrow('App não encontrado')
    })

    // get_data_quality saiu da whitelist em 2026-08-05 junto com o domínio de
    // governança de dados (extraído para o catalog-guardian). get_qa_summary
    // continua e mantém a garantia do ADR-004 viva.
    it.each(['get_qa_summary'])(
      'roteia %s para targetRole="server" (ADR-004)',
      async (action) => {
        mockQueue.getJobs.mockImplementation(async () => {
          return [{ id: 'job-1', data: { status: 'done', result: {} } }]
        })

        await service.dispatch(action, { projectId: 'p1' })

        expect(mockBroker.enqueue).toHaveBeenCalledWith(
          expect.objectContaining({ action, targetRole: 'server' }),
          { delayMs: undefined },
        )
      },
    )

    it('falha rápido sem enfileirar quando o agent do role alvo está offline', async () => {
      const heartbeat = service['heartbeat'] as unknown as { isOnline: jest.Mock; getLastSeenAt: jest.Mock }
      heartbeat.isOnline.mockReturnValue(false)
      heartbeat.getLastSeenAt.mockReturnValue(Date.now() - 120_000)

      await expect(service.dispatch('open_app', { app: 'chrome' })).rejects.toThrow('Agent desktop offline')
      expect(mockBroker.enqueue).not.toHaveBeenCalled()
    })

    it('replay idempotente não duplica o evento de execução', async () => {
      mockBroker.enqueue
        .mockResolvedValueOnce({
          task: { id: 'idem-1', status: 'pending' },
          replayed: false,
        })
        .mockResolvedValueOnce({
          task: { id: 'idem-1', status: 'pending' },
          replayed: true,
        })

      await service.enqueue('notify', { message: 'oi' }, undefined, 'notification:1')
      await service.enqueue('notify', { message: 'oi' }, undefined, 'notification:1')

      expect(mockEventService.create).toHaveBeenCalledTimes(1)
    })
  })

  describe('waitForResult', () => {
    it.each([
      ['effect_unknown', 'exige reconciliação humana'],
      ['failed_safe', 'falha segura'],
      ['compensated', 'foi compensado'],
    ])('encerra a espera para estado terminal %s', async (status, message) => {
      mockQueue.getJobs.mockResolvedValue([{ id: 'job-1', data: { status } }])

      await expect(service.waitForResult('job-1')).rejects.toThrow(message)
    })

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

describe('papelDaAcao — onde a sessão roda (S3)', () => {
  it('sem a variável, a sessão continua no PC', () => {
    expect(papelDaAcao('supervised_session', {})).toBe('desktop')
  })
  it('com SESSAO_NO_SERVIDOR=true, vai para o servidor (sandbox)', () => {
    expect(papelDaAcao('supervised_session', { SESSAO_NO_SERVIDOR: 'true' })).toBe('server')
  })
  it('a variável não move nenhuma outra ação', () => {
    expect(papelDaAcao('create_project_folder', { SESSAO_NO_SERVIDOR: 'true' })).toBe('desktop')
    expect(papelDaAcao('docker_ps', { SESSAO_NO_SERVIDOR: 'true' })).toBe('server')
  })
})

describe('papelDaAcao — leitura de arquivo pelo servidor (17/11)', () => {
  it('sem a chave, a leitura continua no PC', () => {
    expect(papelDaAcao('project_read_file', {})).toBe('desktop')
  })
  it('com LEITURA_NO_SERVIDOR=true, as duas leituras vão ao servidor — e só elas', () => {
    expect(papelDaAcao('project_read_file', { LEITURA_NO_SERVIDOR: 'true' })).toBe('server')
    expect(papelDaAcao('project_list_files', { LEITURA_NO_SERVIDOR: 'true' })).toBe('server')
    expect(papelDaAcao('file_read', { LEITURA_NO_SERVIDOR: 'true' })).toBe('desktop')
  })
})
