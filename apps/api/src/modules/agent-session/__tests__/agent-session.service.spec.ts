import { Test, TestingModule } from '@nestjs/testing'
import { getQueueToken } from '@nestjs/bull'
import { AgentSessionService } from '../agent-session.service'
import { ExecutionService } from '../../execution/execution.service'
import { EventService } from '../../event/event.service'
import { AgentHeartbeatService } from '../../agent-bridge/agent-heartbeat.service'
import { PrismaService } from '../../../prisma/prisma.service'
import { TelegramService } from '../../telegram/telegram.service'
import { PendingReplyService } from '../pending-reply.service'

/**
 * ── A03 da auditoria de 13/09, reproduzido em P1 ──────────────────────────────
 *
 * `AgentSessionService.create` criava a `AgentSession` e gravava uma linha em `task_logs` com
 * `module: 'agent'`, `action: 'jarvis:supervised_session'`. **Nunca enfileirava.** O executor do
 * agent despacha por `${module}:${action}`, ou seja `jarvis:supervised_session`, enquanto aquela
 * linha produziria `agent:jarvis:supervised_session`.
 *
 * Duas medições tornam o conserto menor do que parece:
 *
 *  - `ACTION_ROLE` do `ExecutionService` **já** mapeia `supervised_session → desktop`, e o
 *    `executor.ts`, a whitelist e o `role-policy` do agent **já** conhecem a ação. A única peça
 *    ausente era o enqueue.
 *  - `task_logs` tem **um escritor e nenhum leitor** no monorepo inteiro. Não era uma fila
 *    concorrente: era um beco sem saída. As cinco linhas `pending` desde junho nunca seriam
 *    consumidas por ninguém.
 *
 * Este teste usa o `ExecutionService` REAL (com a fila mockada), não um duplo do serviço: o que
 * precisa ser provado é que o produtor real produz a chave que o consumidor real espera. Com os
 * dois lados mockados, a asserção passaria mesmo com o par errado — que é exatamente como o
 * defeito sobreviveu desde junho.
 */

/** O que `executor.ts` usa no `switch`: `${task.module}:${task.action}`. */
const CHAVE_ESPERADA_PELO_EXECUTOR = 'jarvis:supervised_session'

describe('AgentSessionService.create — o pedido alcança a fila que o executor consome', () => {
  let service: AgentSessionService
  let queue: { add: jest.Mock; getJobs: jest.Mock }
  let prisma: {
    agentSession: { create: jest.Mock; findUnique: jest.Mock; update: jest.Mock }
    taskLog: { create: jest.Mock }
  }
  let telegram: { send: jest.Mock; setReplyHandler: jest.Mock; clearReplyHandler: jest.Mock }
  let heartbeat: { isOnline: jest.Mock; getLastSeenAt: jest.Mock }

  beforeEach(async () => {
    jest.clearAllMocks()

    queue = { add: jest.fn().mockResolvedValue({}), getJobs: jest.fn().mockResolvedValue([]) }
    prisma = {
      agentSession: {
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'sess-1', ...data })),
        findUnique: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockResolvedValue({}),
      },
      taskLog: { create: jest.fn().mockResolvedValue({}) },
    }
    telegram = { send: jest.fn().mockResolvedValue(undefined), setReplyHandler: jest.fn(), clearReplyHandler: jest.fn() }
    heartbeat = { isOnline: jest.fn().mockReturnValue(true), getLastSeenAt: jest.fn().mockReturnValue(Date.now()) }

    const mod: TestingModule = await Test.createTestingModule({
      providers: [
        AgentSessionService,
        ExecutionService,
        { provide: getQueueToken('agent-tasks'), useValue: queue },
        { provide: EventService, useValue: { create: jest.fn().mockResolvedValue(undefined) } },
        { provide: AgentHeartbeatService, useValue: heartbeat },
        { provide: PrismaService, useValue: prisma },
        { provide: TelegramService, useValue: telegram },
        { provide: PendingReplyService, useValue: { responder: jest.fn().mockResolvedValue(true) } },
      ],
    }).compile()

    service = mod.get(AgentSessionService)
  })

  it('enfileira de verdade, com o par module/action que o executor despacha', async () => {
    await service.create('proj-1', 'faça uma alteração pequena')

    expect(queue.add).toHaveBeenCalledTimes(1)
    const [, task] = queue.add.mock.calls[0]
    expect(`${task.module}:${task.action}`).toBe(CHAVE_ESPERADA_PELO_EXECUTOR)
  })

  it('o trabalho vai para o desktop — supervised_session não roda no agent-server', async () => {
    await service.create('proj-1', 'prompt')

    const [, task] = queue.add.mock.calls[0]
    expect(task.targetRole).toBe('desktop')
  })

  it('o payload carrega sessionId, prompt e projectId — o executor precisa dos três', async () => {
    await service.create('proj-42', 'implementar o cache')

    const [, task] = queue.add.mock.calls[0]
    expect(task.payload).toMatchObject({
      sessionId: 'sess-1',
      prompt: 'implementar o cache',
      projectId: 'proj-42',
    })
  })

  it('não grava mais em task_logs — a tabela não tem leitor nenhum', async () => {
    await service.create('proj-1', 'prompt')

    expect(prisma.taskLog.create).not.toHaveBeenCalled()
  })

  it('devolve a sessão com id — a referência persistente e consultável do trabalho', async () => {
    const sessao = await service.create('proj-1', 'prompt')

    expect(sessao.id).toBe('sess-1')
  })

  /**
   * "Recebido" não pode significar "iniciado". Se o executor não está disponível, a sessão não
   * pode ficar `active` para sempre esperando alguém que nunca virá — foi exatamente esse o
   * estado encontrado em produção: 4 sessões `active` paradas desde junho.
   */
  describe('quando o enqueue falha', () => {
    beforeEach(() => {
      heartbeat.isOnline.mockReturnValue(false)
      heartbeat.getLastSeenAt.mockReturnValue(null)
    })

    it('propaga o erro em vez de devolver uma sessão que ninguém vai executar', async () => {
      await expect(service.create('proj-1', 'prompt')).rejects.toThrow(/offline/i)
    })

    it('marca a sessão como error, para não ficar active fantasma', async () => {
      await service.create('proj-1', 'prompt').catch(() => null)

      expect(prisma.agentSession.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'sess-1' },
          data: expect.objectContaining({ status: 'error' }),
        }),
      )
    })

    it('não anuncia no Telegram uma sessão que ninguém vai executar', async () => {
      await service.create('proj-1', 'prompt').catch(() => null)

      expect(telegram.send).not.toHaveBeenCalled()
    })
  })

  /**
   * A06: a sessão deixou de registrar callback de resposta. O roteamento sai do estado
   * persistido (`status: 'waiting'`), resolvido por `PendingReplyService` — um callback em
   * memória se perdia no restart, era sobrescrito pela sessão seguinte, e desviava toda mensagem
   * de todo chat enquanto estivesse armado.
   */
  describe('roteamento de resposta', () => {
    it('não registra callback global no Telegram', async () => {
      await service.create('proj-1', 'prompt')

      expect(telegram.setReplyHandler).not.toHaveBeenCalled()
    })
  })
})
