import { Test, TestingModule } from '@nestjs/testing'
import { getQueueToken } from '@nestjs/bull'
import { AgentSessionService, type VerificacaoIndependenteDaSessao, PUBLICACAO_RECUSADA_POR_PRAZO } from '../agent-session.service'
import { ExecutionService } from '../../execution/execution.service'
import { EventService } from '../../event/event.service'
import { AgentHeartbeatService } from '../../agent-bridge/agent-heartbeat.service'
import { AgentTaskBrokerService } from '../../agent-bridge/agent-task-broker.service'
import { PrismaService } from '../../../prisma/prisma.service'
import { TelegramService } from '../../telegram/telegram.service'
import { PendingReplyService } from '../pending-reply.service'
import { CANAL_DE_AVISO, CanalTelegram } from '../canal-de-aviso'

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
  let queue: { add: jest.Mock; getJobs: jest.Mock; getJob: jest.Mock; client: { set: jest.Mock; get: jest.Mock } }
  let prisma: {
    agentSession: { create: jest.Mock; findUnique: jest.Mock; update: jest.Mock; updateMany: jest.Mock }
    taskLog: { create: jest.Mock }
  }
  let telegram: { send: jest.Mock; setReplyHandler: jest.Mock; clearReplyHandler: jest.Mock }
  let heartbeat: { isOnline: jest.Mock; getLastSeenAt: jest.Mock }

  beforeEach(async () => {
    jest.clearAllMocks()

    const idempotency = new Map<string, string>()
    const jobs = new Map<string, { id: string; data: unknown }>()
    queue = {
      client: {
        set: jest.fn(async (key: string, value: string, mode: string) => {
          if (mode === 'NX' && idempotency.has(key)) return null
          idempotency.set(key, value)
          return 'OK'
        }),
        get: jest.fn(async (key: string) => idempotency.get(key) ?? null),
      },
      add: jest.fn(async (_name: string, data: { id: string }, opts: { jobId: string }) => {
        if (!jobs.has(opts.jobId)) jobs.set(opts.jobId, { id: opts.jobId, data })
        return jobs.get(opts.jobId)
      }),
      getJob: jest.fn(async (id: string) => jobs.get(id) ?? null),
      getJobs: jest.fn(async () => [...jobs.values()]),
    }
    prisma = {
      agentSession: {
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'sess-1', ...data })),
        findUnique: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      taskLog: { create: jest.fn().mockResolvedValue({}) },
    }
    telegram = { send: jest.fn().mockResolvedValue(undefined), setReplyHandler: jest.fn(), clearReplyHandler: jest.fn() }
    heartbeat = { isOnline: jest.fn().mockReturnValue(true), getLastSeenAt: jest.fn().mockReturnValue(Date.now()) }

    const mod: TestingModule = await Test.createTestingModule({
      providers: [
        AgentSessionService,
        ExecutionService,
        AgentTaskBrokerService,
        { provide: getQueueToken('agent-tasks'), useValue: queue },
        { provide: EventService, useValue: { create: jest.fn().mockResolvedValue(undefined) } },
        { provide: AgentHeartbeatService, useValue: heartbeat },
        { provide: PrismaService, useValue: prisma },
        { provide: TelegramService, useValue: telegram },
        { provide: CANAL_DE_AVISO, useClass: CanalTelegram },
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

  describe('solicitarParada', () => {
    it('só marca stopping enquanto a sessão está ativa', async () => {
      prisma.agentSession.findUnique.mockResolvedValue({ id: 'sess-1', status: 'stopping' })

      await service.solicitarParada('sess-1')

      expect(prisma.agentSession.updateMany).toHaveBeenCalledWith({
        where: { id: 'sess-1', status: 'active' },
        data: { status: 'stopping' },
      })
    })

    it('marca stopped condicionalmente depois que o agent interrompeu o container', async () => {
      await service.marcarParada('sess-1')

      expect(prisma.agentSession.updateMany).toHaveBeenCalledWith({
        where: { id: 'sess-1', status: 'stopping' },
        data: { status: 'stopped', summary: 'Sessão interrompida pelo usuário.' },
      })
    })
  })

  describe('registrarMetricas', () => {
    it('soma custo e turnos de chamadas sucessivas', async () => {
      prisma.agentSession.findUnique
        .mockResolvedValueOnce({ costUsd: null, numTurns: null })
        .mockResolvedValueOnce({ costUsd: 0.01, numTurns: 2 })
      prisma.agentSession.update.mockResolvedValue({})

      await service.registrarMetricas('sess-1', { costUsd: 0.01, numTurns: 2 })
      await service.registrarMetricas('sess-1', { costUsd: 0.02, numTurns: 3 })

      expect(prisma.agentSession.update.mock.calls.map(([args]) => args.data)).toEqual([
        { costUsd: 0.01, numTurns: 2 },
        { costUsd: 0.03, numTurns: 5 },
      ])
    })

    it('campo ausente não zera métricas já gravadas e atualiza os demais campos enviados', async () => {
      prisma.agentSession.findUnique.mockResolvedValue({ costUsd: 0.03, numTurns: 5 })
      prisma.agentSession.update.mockResolvedValue({})

      await service.registrarMetricas('sess-1', { modelo: 'claude-sonnet-4-5', provedor: 'claude-code' })

      expect(prisma.agentSession.update).toHaveBeenCalledWith({
        where: { id: 'sess-1' },
        data: { modelo: 'claude-sonnet-4-5', provedor: 'claude-code' },
      })
    })

    it('persiste o resultado da verificação independente sem somá-lo como métrica numérica', async () => {
      prisma.agentSession.findUnique.mockResolvedValue({ costUsd: 0.03, numTurns: 5 })
      prisma.agentSession.update.mockResolvedValue({})
      const testVerification: VerificacaoIndependenteDaSessao = {
        status: 'passou',
        comando: 'npm ci && npm test',
        codigo: 0,
        duracaoMs: 175,
        ultimasLinhas: ['passou'],
      }

      await service.registrarMetricas('sess-1', { testVerification })

      expect(prisma.agentSession.update).toHaveBeenCalledWith({
        where: { id: 'sess-1' },
        data: { testVerification },
      })
    })
  })

  describe('complete', () => {
    it('persiste a verificação independente junto com a conclusão', async () => {
      prisma.agentSession.update.mockResolvedValue({})
      const testVerification: VerificacaoIndependenteDaSessao = {
        status: 'falhou',
        comando: 'npm ci && npm test',
        codigo: 1,
        duracaoMs: 175,
        ultimasLinhas: ['falha'],
      }

      await service.complete('sess-1', 'Pronto', undefined, testVerification)

      expect(prisma.agentSession.update).toHaveBeenCalledWith({
        where: { id: 'sess-1' },
        data: {
          status: 'completed',
          summary: 'Pronto',
          previewUrl: null,
          testVerification,
        },
      })
    })

    // G5.1 (23/11): o portão venceu sem resposta e a sessão concluiu sem publicar. Sem a recusa
    // gravada o envelope ficava `effect_unknown`, e a pessoa só tinha "Descartar".
    const PORTAO = { status: 'waiting', pendingRequiresApproval: true, pendingApprovalOptions: ['Aprovado, mesclar', 'Aprovado, só abrir PR', 'Não publicar'] }

    it('concluir ainda esperando o portão de publicação grava a recusa por prazo', async () => {
      prisma.agentSession.findUnique.mockResolvedValue(PORTAO)
      prisma.agentSession.update.mockResolvedValue({})
      await service.complete('sess-1', 'Nada foi publicado')
      const data = prisma.agentSession.update.mock.calls[0][0].data
      expect(data.publicacaoRecusadaEm).toBeInstanceOf(Date)
      expect(data.publicacaoRecusadaPor).toBe(PUBLICACAO_RECUSADA_POR_PRAZO)
      expect(data.pendingQuestion).toBeNull()
    })

    it.each([
      ['a pergunta foi respondida', { ...PORTAO, status: 'active' }],
      ['era uma pergunta comum', { ...PORTAO, pendingRequiresApproval: false }],
      ['o portão não era de publicação', { ...PORTAO, pendingApprovalOptions: ['Aprovado, continue', 'Rejeitar e corrigir'] }],
      ['a sessão não foi achada', null],
    ])('não grava recusa quando %s', async (_caso, antes) => {
      prisma.agentSession.findUnique.mockResolvedValue(antes)
      prisma.agentSession.update.mockResolvedValue({})
      await service.complete('sess-1', 'Pronto')
      expect(prisma.agentSession.update.mock.calls[0][0].data).not.toHaveProperty('publicacaoRecusadaEm')
    })
  })
})
