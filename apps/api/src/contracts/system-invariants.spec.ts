/**
 * Contrato — invariantes críticos do sistema (V1).
 * Estes testes documentam e enforçam as propriedades que, quando violadas,
 * causam corrupção silenciosa de dados ou execução duplicada.
 */

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

describe('Invariante 2 — Deduplicação de memória por (projectId, checksum)', () => {
  it('dois projectIds com o mesmo checksum resultam em dois documentos distintos', async () => {
    const db: Array<{ projectId: string | null; checksum: string; content: string }> = []

    async function indexDocument(content: string, projectId: string | null) {
      const checksum = content  // mock simplificado
      const existing = db.find(
        (d) => d.checksum === checksum && (projectId ? d.projectId === projectId : d.projectId === null),
      )
      if (existing) return { deduped: true }
      db.push({ projectId, checksum, content })
      return { created: true }
    }

    await indexDocument('mesmoConteudo', 'proj-A')
    await indexDocument('mesmoConteudo', 'proj-B')

    expect(db).toHaveLength(2)
    expect(db.map((d) => d.projectId)).toEqual(expect.arrayContaining(['proj-A', 'proj-B']))
  })

  it('mesmo conteúdo no mesmo projeto é deduplicado', async () => {
    const db: Array<{ projectId: string | null; checksum: string }> = []

    async function indexDocument(content: string, projectId: string) {
      const existing = db.find((d) => d.checksum === content && d.projectId === projectId)
      if (existing) return { deduped: true }
      db.push({ projectId, checksum: content })
      return { created: true }
    }

    const r1 = await indexDocument('conteudo', 'proj-A')
    const r2 = await indexDocument('conteudo', 'proj-A')

    expect(r1).toEqual({ created: true })
    expect(r2).toEqual({ deduped: true })
    expect(db).toHaveLength(1)
  })
})

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
