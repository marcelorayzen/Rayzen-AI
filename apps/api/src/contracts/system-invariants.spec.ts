/**
 * Contrato — invariantes críticos do sistema (V1).
 *
 * ATENÇÃO ao ler este arquivo: só o **Invariante 2** exercita código de produção.
 *
 * Os invariantes 1 e 3 definem a função sob teste **dentro do próprio teste** e
 * validam esse mock. Documentam a propriedade desejada, mas não podem detectar
 * violação nenhuma — passam verdes com a produção divergindo.
 *
 * Não é hipótese: o Invariante 2 era assim e ficou verde por meses enquanto o
 * `BrainService` deduplicava sem `projectId`. Corrigido em 2026-08-16, e a
 * correção foi validada reintroduzindo o defeito — 3 dos 7 testes falharam.
 *
 * TODO — dar o mesmo tratamento aos outros dois:
 *   1. o alvo real é o `workspace-watcher` (apps/agent). Como está em outro app,
 *      seguir o padrão de `memory-ranking.spec.ts`: ler o arquivo como texto.
 *   3. o alvo real é o claim em `agent-bridge` (mesmo app) — dá para importar.
 */

import { BrainService } from '../modules/brain/brain.service'
import { MemoryService } from '../modules/memory/memory.service'

// ⚠️  MOCK LOCAL — não testa produção. Alvo real: apps/agent/src/workspace-watcher.ts
// ─── Invariante 1: Documentos nunca ficam órfãos ────────────────────────────

describe('Invariante 1 — Documentos sempre têm projectId', () => {
  it('indexChangedFiles não indexa quando projectId é undefined', () => {
    // O watcher verifica projectId ANTES de chamar /memory/index.
    // Se projectId for undefined, o arquivo é silenciosamente ignorado.
    // Contrato: api.post('/memory/index') nunca é chamado sem projectId.
    const called: unknown[] = []
    const api = { post: (...args: unknown[]) => { called.push(args); return Promise.resolve() } }

    async function indexChangedFiles(files: string[], projectId: string | undefined) {
      if (!projectId) return  // ← invariante
      for (const file of files) {
        await api.post('/memory/index', { content: file, projectId })
      }
    }

    indexChangedFiles(['src/main.ts'], undefined)
    expect(called).toHaveLength(0)
  })

  it('indexChangedFiles indexa quando projectId está presente', async () => {
    const called: unknown[] = []
    const api = { post: (...args: unknown[]) => { called.push(args); return Promise.resolve() } }

    async function indexChangedFiles(files: string[], projectId: string | undefined) {
      if (!projectId) return
      for (const file of files) {
        await api.post('/memory/index', { content: file, projectId })
      }
    }

    await indexChangedFiles(['src/main.ts'], 'proj-123')
    expect(called).toHaveLength(1)
    expect((called[0] as unknown[])[1]).toMatchObject({ projectId: 'proj-123' })
  })
})

// ─── Invariante 2: Deduplicação de memória é por (projectId, checksum) ───────

/**
 * Este teste importa os DOIS services de verdade, de propósito.
 *
 * A versão anterior definia um `indexDocument` local e o testava — validava o
 * mock que ela mesma escrevia. Passou verde por meses enquanto o
 * `BrainService.indexDocument` deduplicava por `findFirst({ where: { checksum } })`,
 * SEM `projectId`, enquanto o `MemoryService` escopava por projeto. As duas
 * escrevem na MESMA tabela `documents`: conteúdo idêntico em dois projetos fazia
 * o segundo herdar o documento do primeiro, e o que o citasse passava a apontar
 * para dado de outro projeto — silenciosamente. Mesma família do incidente da
 * Urna (2026-08-03).
 *
 * Teste que reimplementa o alvo não pode falhar pelo motivo certo.
 */
describe('Invariante 2 — Deduplicação de memória por (projectId, checksum)', () => {
  const VETOR = new Array(1024).fill(0.1)

  function mockPrisma() {
    return {
      document: { findFirst: jest.fn().mockResolvedValue(null) },
      $executeRaw: jest.fn().mockResolvedValue(1),
      $queryRaw:   jest.fn().mockResolvedValue([]),
    }
  }

  const config  = { get: () => 'chave-fake' } as never
  const eventNo = { create: jest.fn().mockResolvedValue(null) } as never

  async function indexarPeloBrain(prisma: ReturnType<typeof mockPrisma>, projectId?: string) {
    const svc = new BrainService(prisma as never, config, eventNo,
      { delPattern: jest.fn(), del: jest.fn() } as never)
    jest.spyOn(svc, 'embed').mockResolvedValue(VETOR)
    await svc.indexDocument('mesmo conteudo', 'arquivo.ts', {}, projectId)
  }

  async function indexarPelaMemoria(prisma: ReturnType<typeof mockPrisma>, projectId?: string) {
    const svc = new MemoryService(prisma as never, config, eventNo,
      { recordEmbedding: jest.fn(), recordIndexed: jest.fn() } as never)
    jest.spyOn(svc as unknown as { embed: () => Promise<number[]> }, 'embed').mockResolvedValue(VETOR)
    await svc.indexDocument('mesmo conteudo', 'arquivo.ts', {}, projectId)
  }

  /** A busca de dedup — a que decide se reaproveita linha de outro projeto. */
  const buscaDeDedup = (prisma: ReturnType<typeof mockPrisma>) =>
    prisma.document.findFirst.mock.calls
      .map((c) => c[0]?.where)
      .find((w) => w && 'checksum' in w)

  it('BrainService escopa o dedup por projeto', async () => {
    const prisma = mockPrisma()
    await indexarPeloBrain(prisma, 'proj-A')

    expect(buscaDeDedup(prisma)).toMatchObject({ projectId: 'proj-A' })
  })

  it('MemoryService escopa o dedup por projeto', async () => {
    const prisma = mockPrisma()
    await indexarPelaMemoria(prisma, 'proj-A')

    expect(buscaDeDedup(prisma)).toMatchObject({ projectId: 'proj-A' })
  })

  it('os dois caminhos concordam — divergir reintroduz o vazamento entre projetos', async () => {
    const brain  = mockPrisma()
    const memory = mockPrisma()
    await indexarPeloBrain(brain, 'proj-A')
    await indexarPelaMemoria(memory, 'proj-A')

    const chaves = (w: Record<string, unknown> | undefined) => Object.keys(w ?? {}).sort()
    expect(chaves(buscaDeDedup(brain))).toEqual(chaves(buscaDeDedup(memory)))
  })

  it('sem projectId, os dois procuram por documento órfão — nunca por qualquer projeto', async () => {
    // `projectId: null` é diferente de omitir: omitir casaria a linha de QUALQUER
    // projeto, que é exatamente o defeito que este invariante existe para barrar.
    const brain  = mockPrisma()
    const memory = mockPrisma()
    await indexarPeloBrain(brain)
    await indexarPelaMemoria(memory)

    expect(buscaDeDedup(brain)).toMatchObject({ projectId: null })
    expect(buscaDeDedup(memory)).toMatchObject({ projectId: null })
  })
})

// ⚠️  MOCK LOCAL — não testa produção. Alvo real: apps/api/src/modules/agent-bridge/
// ─── Invariante 3: Claim atômico de task ─────────────────────────────────────

describe('Invariante 3 — Claim atômico de task via Redis NX', () => {
  it('dois agents simultâneos não reivindicam a mesma task', async () => {
    const locks = new Map<string, string>()

    function redisSetNX(key: string, value: string): boolean {
      if (locks.has(key)) return false
      locks.set(key, value)
      return true
    }

    const task = { id: 'task-1', status: 'pending' }
    const claimed: string[] = []

    async function claimTask(agentId: string): Promise<boolean> {
      const lockKey = `claim:task:${task.id}`
      const locked = redisSetNX(lockKey, agentId)
      if (!locked) return false
      claimed.push(agentId)
      return true
    }

    // Simula dois agents tentando reivindicar ao mesmo tempo
    const results = await Promise.all([
      claimTask('agent-A'),
      claimTask('agent-B'),
    ])

    expect(results.filter(Boolean)).toHaveLength(1)
    expect(claimed).toHaveLength(1)
  })
})
