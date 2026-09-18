import { Test, TestingModule } from '@nestjs/testing'
import { getQueueToken } from '@nestjs/bull'
import { AgentBridgeService } from '../agent-bridge.service'
import { Task } from '@rayzen/types'

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
  let queue: { add: jest.Mock; getJobs: jest.Mock; client: unknown }

  function build(jobs: ReturnType<typeof job>[]) {
    client = redisFake()
    queue = { add: jest.fn(), getJobs: jest.fn().mockResolvedValue(jobs), client }
    return Test.createTestingModule({
      providers: [AgentBridgeService, { provide: getQueueToken('agent-tasks'), useValue: queue }],
    }).compile().then((m: TestingModule) => { service = m.get(AgentBridgeService) })
  }

  describe('claim', () => {
    it('reivindica pendente e registra a posse', async () => {
      const j = job()
      await build([j])

      const t = await service.claimTask('desktop', 'PC-CASA')

      expect(t?.status).toBe('processing')
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
      await service.claimTask('desktop', 'PC-CASA')

      expect(await service.renovarPosse('task-1', 'PC-CASA')).toBe(true)
    })

    it('quem não é dono NÃO renova — posse não se rouba renovando', async () => {
      const j = job()
      await build([j])
      await service.claimTask('desktop', 'PC-CASA')

      expect(await service.renovarPosse('task-1', 'PC-TRABALHO')).toBe(false)
    })

    it('renovar tarefa sem posse ativa não recria o lease', async () => {
      const j = job()
      await build([j])
      await service.claimTask('desktop', 'PC-CASA')
      client.expirar('claim:task:task-1')

      expect(await service.renovarPosse('task-1', 'PC-CASA')).toBe(false)
    })
  })

  describe('recuperação de órfão', () => {
    /**
     * O comportamento central: o executor morreu, o lease expirou, e a tarefa **não é
     * re-executada**. Vira falha explícita, porque não se sabe se o efeito ocorreu — repetir
     * cegamente é o único desfecho pior que ficar preso.
     */
    it('processing sem posse vira failed com motivo explícito, e NÃO é re-executada', async () => {
      const j = job({ status: 'processing' })
      await build([j])
      // Nenhum lease no Redis: é o estado de quem foi reclamado e teve o agent morto.

      const t = await service.claimTask('desktop', 'PC-NOVO')

      expect(t).toBeNull()                       // não devolve a órfã para execução
      expect(j.data.status).toBe('failed')
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

      expect(orfa.data.status).toBe('failed')
      expect(t?.id).toBe('task-nova')
    })
  })
})
