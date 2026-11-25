import { Test, TestingModule } from '@nestjs/testing'
import { getQueueToken } from '@nestjs/bull'
import { AgentBridgeService } from '../agent-bridge.service'
import { Task } from '@rayzen/types'
import { PrismaService } from '../../../prisma/prisma.service'

/**
 * ── A05 da auditoria de 13/09 ─────────────────────────────────────────────────
 *
 * `claimTask` buscava jobs e filtrava `status === 'pending'`. Um job que virou `processing` e
 * cujo agent morreu **nunca mais era tocado por ninguém**: não voltava a ser reclamável, não
 * falhava, não aparecia. Três jobs estavam presos assim desde 17/06/2026.
 *
 * O conserto ingênuo — aceitar `processing` antigo — é PIOR que o defeito. Sem saber se o
 * executor ainda está vivo, um limiar de tempo reclamaria uma tarefa em andamento e produziria
 * efeito duplicado; o defeito atual ao menos falha parado. E o limiar seria necessariamente um
 * chute, porque uma sessão supervisionada dura horas enquanto um `screenshot` dura segundos.
 *
 * Daí o lease renovado: o lock do Redis deixa de ser "teto de duração" (o comentário antigo dizia
 * `30_000 // cobre o tempo máximo de processamento`, o que nunca foi verdade para sessão
 * supervisionada) e passa a ser **sinal de vida**. Quem executa renova; quem morre para de
 * renovar, e a ausência do lease é a evidência — não o relógio.
 */

/** Redis falso com expiração sob controle do teste — morte de agent não se simula esperando. */
function redisFake() {
  const chaves = new Map<string, string>()
  let sequencia = 0
  return {
    chaves,
    expirar: (key: string) => chaves.delete(key),
    set: jest.fn(async (key: string, valor: string, _px: string, _ttl: number, modo?: string) => {
      if (modo === 'NX' && chaves.has(key)) return null
      if (modo === 'XX' && !chaves.has(key)) return null
      chaves.set(key, valor)
      return 'OK'
    }),
    get: jest.fn(async (key: string) => chaves.get(key) ?? null),
    incr: jest.fn(async () => ++sequencia),
    del: jest.fn(async (key: string) => chaves.delete(key) ? 1 : 0),
    eval: jest.fn(async (_script: string, _keys: number, key: string, esperado: string) => {
      if (chaves.get(key) !== esperado) return 0
      chaves.delete(key)
      return 1
    }),
  }
}

function job(overrides: Partial<Task> = {}) {
  const data: Task = {
    id: 'task-1', module: 'jarvis', action: 'screenshot', payload: {},
    status: 'pending', targetRole: 'desktop', createdAt: '', updatedAt: '',
    ...overrides,
  }
  const j = {
    id: data.id,
    data,
    update: jest.fn(async (novo: Task) => { j.data = novo }),
  }
  return j
}

describe('AgentBridgeService — posse da execução e recuperação de órfão', () => {
  let service: AgentBridgeService
  let client: ReturnType<typeof redisFake>
  let queue: { add: jest.Mock; getJobs: jest.Mock; getJob: jest.Mock; client: unknown }

  function build(jobs: ReturnType<typeof job>[]) {
    client = redisFake()
    queue = {
      add: jest.fn(),
      getJobs: jest.fn().mockResolvedValue(jobs),
      getJob: jest.fn(async (id: string) => jobs.find((j) => j.id === id) ?? null),
      client,
    }
    return Test.createTestingModule({
      providers: [
        AgentBridgeService,
        { provide: getQueueToken('agent-tasks'), useValue: queue },
        // Fase 4: o ciclo de vida da tarefa sincroniza o ProjectHandoff. Aqui nao ha
        // envelope — `findFirst` devolve null, que e o caminho da maioria das tarefas e o
        // que estes casos medem. O caminho COM envelope tem spec proprio em modules/handoff.
        { provide: PrismaService, useValue: { projectHandoff: { findFirst: jest.fn().mockResolvedValue(null), update: jest.fn() } } },
      ],
    }).compile().then((m: TestingModule) => { service = m.get(AgentBridgeService) })
  }

  describe('claim', () => {
    it('reivindica pendente e registra a posse', async () => {
      const j = job()
      await build([j])

      const t = await service.claimTask('desktop', 'PC-CASA')

      expect(t?.status).toBe('processing')
      expect(t?.fencingToken).toBe('1')
      expect(client.chaves.size).toBe(1)
    })

    it('segundo agent não rouba tarefa com posse ativa', async () => {
      const j = job()
      await build([j])

      await service.claimTask('desktop', 'PC-CASA')
      const segundo = await service.claimTask('desktop', 'PC-TRABALHO')

      expect(segundo).toBeNull()
    })
  })

  describe('renovação da posse', () => {
    it('o dono renova enquanto executa — tarefa longa não perde a posse', async () => {
      const j = job()
      await build([j])
      const task = await service.claimTask('desktop', 'PC-CASA')

      expect(await service.renovarPosse('task-1', 'PC-CASA', task?.fencingToken)).toBe(true)
    })

    it('quem não é dono NÃO renova — posse não se rouba renovando', async () => {
      const j = job()
      await build([j])
      const task = await service.claimTask('desktop', 'PC-CASA')

      expect(await service.renovarPosse('task-1', 'PC-TRABALHO', task?.fencingToken)).toBe(false)

      expect(await service.renovarPosse('task-1', 'PC-CASA', 'token-antigo')).toBe(false)
    })

    it('renovar tarefa sem posse ativa não recria o lease', async () => {
      const j = job()
      await build([j])
      const task = await service.claimTask('desktop', 'PC-CASA')
      client.expirar('claim:task:task-1')

      expect(await service.renovarPosse('task-1', 'PC-CASA', task?.fencingToken)).toBe(false)
    })
  })

  describe('recuperação de órfão', () => {
    /**
     * O comportamento central: o executor morreu, o lease expirou, e a tarefa **não é
     * re-executada**. Vira falha explícita, porque não se sabe se o efeito ocorreu — repetir
     * cegamente é o único desfecho pior que ficar preso.
     */
    it('processing sem posse vira effect_unknown, e NÃO é re-executada', async () => {
      const j = job({ status: 'processing' })
      await build([j])
      // Nenhum lease no Redis: é o estado de quem foi reclamado e teve o agent morto.

      const t = await service.claimTask('desktop', 'PC-NOVO')

      expect(t).toBeNull()                       // não devolve a órfã para execução
      expect(j.data.status).toBe('effect_unknown')
      expect(j.data.error).toMatch(/posse/i)
      expect(j.data.error).toMatch(/verifique/i) // estado incerto declarado a quem for ler
    })

    it('processing COM posse ativa é deixada em paz — execução viva não é interrompida', async () => {
      const j = job()
      await build([j])
      await service.claimTask('desktop', 'PC-CASA')   // vira processing, com lease

      await service.claimTask('desktop', 'PC-NOVO')   // outro agent poda órfãos ao pedir trabalho

      expect(j.data.status).toBe('processing')
      expect(j.data.error).toBeUndefined()
    })

    it('tarefa pending nunca é confundida com órfã', async () => {
      const j = job()
      await build([j])

      await service.claimTask('server', 'VPS')  // role diferente: não reivindica esta

      expect(j.data.status).toBe('pending')
    })

    it('a órfã podada libera a fila — a próxima pendente é atendida na mesma chamada', async () => {
      const orfa = job({ id: 'task-orfa', status: 'processing' })
      const nova = job({ id: 'task-nova' })
      await build([orfa, nova])

      const t = await service.claimTask('desktop', 'PC-NOVO')

      expect(orfa.data.status).toBe('effect_unknown')
      expect(t?.id).toBe('task-nova')
    })
  })

  describe('fencing do resultado', () => {
    it('aceita somente o resultado do claim que ainda possui o lease', async () => {
      const j = job()
      await build([j])
      const task = await service.claimTask('desktop', 'PC-CASA')

      const resultado = await service.updateStatus(
        'task-1', 'done', { ok: true }, undefined, 'PC-CASA', task?.fencingToken,
      )

      expect(resultado).toBe('updated')
      expect(j.data.status).toBe('done')
    })

    it('executor antigo nao sobrescreve effect_unknown depois de perder a posse', async () => {
      const j = job()
      await build([j])
      const task = await service.claimTask('desktop', 'PC-CASA')
      client.expirar('claim:task:task-1')

      await service.claimTask('desktop', 'PC-NOVO')
      expect(j.data.status).toBe('effect_unknown')

      const atrasado = await service.updateStatus(
        'task-1', 'done', { ok: true }, undefined, 'PC-CASA', task?.fencingToken,
      )
      expect(atrasado).toBe('stale')
      expect(j.data.status).toBe('effect_unknown')
    })

    it('conclusao e reconciliacao nao atravessam a mesma transicao', async () => {
      const j = job()
      await build([j])
      const task = await service.claimTask('desktop', 'PC-CASA')

      let iniciou: () => void = () => undefined
      let liberar: () => void = () => undefined
      const inicio = new Promise<void>((resolve) => { iniciou = resolve })
      const bloqueio = new Promise<void>((resolve) => { liberar = resolve })
      j.update.mockImplementationOnce(async (novo: Task) => {
        iniciou()
        await bloqueio
        j.data = novo
      })

      const conclusao = service.updateStatus(
        'task-1', 'done', { ok: true }, undefined, 'PC-CASA', task?.fencingToken,
      )
      await inicio
      client.expirar('claim:task:task-1')

      await service.claimTask('desktop', 'PC-NOVO')
      expect(j.data.status).toBe('processing')

      liberar()
      await expect(conclusao).resolves.toBe('updated')
      expect(j.data.status).toBe('done')
    })

    it('retry da mesma conclusao e idempotente', async () => {
      const j = job()
      await build([j])
      const task = await service.claimTask('desktop', 'PC-CASA')

      await service.updateStatus('task-1', 'done', { ok: true }, undefined, 'PC-CASA', task?.fencingToken)
      const repetida = await service.updateStatus(
        'task-1', 'done', { ok: true }, undefined, 'PC-CASA', task?.fencingToken,
      )

      expect(repetida).toBe('already_applied')
    })
  })

  describe('reconciliação humana de effect_unknown', () => {
    const decisao = {
      outcome: 'effect_not_observed' as const,
      actor: 'approval-token:abc123',
      actorType: 'approval_token' as const,
      reason: 'O efeito foi verificado no sistema externo e não ocorreu.',
      evidence: { ticket: 'INC-42', observed: false },
    }

    it('fecha a incerteza como falha segura e preserva ator, motivo e evidência', async () => {
      const j = job({ status: 'effect_unknown', error: 'efeito incerto' })
      await build([j])

      const result = await service.reconcileEffectUnknown('task-1', decisao)

      expect(result.result).toBe('updated')
      expect(j.data.status).toBe('failed_safe')
      expect(j.data.reconciliation).toEqual(expect.objectContaining({
        outcome: 'effect_not_observed',
        actor: decisao.actor,
        reason: decisao.reason,
        evidence: decisao.evidence,
        resolutionHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      }))
    })

    it.each([
      ['effect_confirmed', 'done'],
      ['compensated', 'compensated'],
    ] as const)('mapeia %s para o estado final %s', async (outcome, status) => {
      const j = job({ status: 'effect_unknown', error: 'efeito incerto' })
      await build([j])

      await service.reconcileEffectUnknown('task-1', { ...decisao, outcome })

      expect(j.data.status).toBe(status)
      expect(j.data.error).toBeUndefined()
    })

    it('retry idêntico é idempotente e não regrava a tarefa', async () => {
      const j = job({ status: 'effect_unknown' })
      await build([j])

      await service.reconcileEffectUnknown('task-1', decisao)
      j.update.mockClear()
      const replay = await service.reconcileEffectUnknown('task-1', {
        ...decisao,
        evidence: { observed: false, ticket: 'INC-42' },
      })

      expect(replay.result).toBe('already_applied')
      expect(j.update).not.toHaveBeenCalled()
    })

    it('recusa decisão diferente depois de uma resolução final', async () => {
      const j = job({ status: 'effect_unknown' })
      await build([j])

      await service.reconcileEffectUnknown('task-1', decisao)
      const conflict = await service.reconcileEffectUnknown('task-1', {
        ...decisao,
        outcome: 'effect_confirmed',
      })

      expect(conflict.result).toBe('stale')
      expect(j.data.status).toBe('failed_safe')
    })

    it('não permite reconciliar tarefa que nunca entrou em effect_unknown', async () => {
      const j = job({ status: 'pending' })
      await build([j])

      const result = await service.reconcileEffectUnknown('task-1', decisao)

      expect(result.result).toBe('stale')
      expect(j.data.status).toBe('pending')
    })

    it('lista somente incertezas, da mais recente para a mais antiga', async () => {
      const antiga = job({ id: 'old', status: 'effect_unknown', updatedAt: '2026-01-01T00:00:00Z' })
      const final = job({ id: 'done', status: 'done', updatedAt: '2026-03-01T00:00:00Z' })
      const nova = job({ id: 'new', status: 'effect_unknown', updatedAt: '2026-02-01T00:00:00Z' })
      await build([antiga, final, nova])

      expect((await service.getEffectUnknown()).map((task) => task.id)).toEqual(['new', 'old'])
    })
  })
})
