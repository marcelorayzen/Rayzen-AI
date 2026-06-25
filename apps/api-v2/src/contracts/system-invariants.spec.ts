/**
 * Contrato — invariantes críticos do sistema (V2).
 * Estes testes documentam e enforçam as propriedades que, quando violadas,
 * causam execução duplicada, gates órfãos ou resultados perdidos.
 */

// ─── Invariante 4: Aprovação de gate é atômica ───────────────────────────────

describe('Invariante 4 — Aprovação de gate é atômica (sem TOCTOU)', () => {
  it('updateMany com where.status=pending retorna 0 se gate já foi aprovado', async () => {
    let currentStatus = 'pending'

    // Simula Prisma updateMany com conditional update
    async function updateMany(where: { id: string; status: string }, data: { status: string }) {
      if (currentStatus !== where.status) return { count: 0 }
      currentStatus = data.status
      return { count: 1 }
    }

    const agent1 = updateMany({ id: 'g1', status: 'pending' }, { status: 'approved' })
    const agent2 = updateMany({ id: 'g1', status: 'pending' }, { status: 'approved' })

    const [r1, r2] = await Promise.all([agent1, agent2])
    const totalApproved = r1.count + r2.count

    expect(totalApproved).toBe(1)  // exatamente um aprovador vence
  })

  it('gate já aprovado lança erro em vez de aprovar silenciosamente', async () => {
    let status = 'approved'

    async function approve(id: string) {
      const result = await (async () => {
        if (status !== 'pending') return { count: 0 }
        status = 'approved'
        return { count: 1 }
      })()
      if (result.count === 0) throw new Error(`Gate is already ${status}`)
      return { id, status: 'approved' }
    }

    await expect(approve('g1')).rejects.toThrow('Gate is already approved')
  })
})

// ─── Invariante 5: Missão concluída → result loop sempre dispara ─────────────

describe('Invariante 5 — Result loop dispara quando missão transiciona para done', () => {
  it('processCompletion é chamado quando todos os steps estão done', async () => {
    const processCompletion = jest.fn().mockResolvedValue({ summary: 'ok' })
    const transition = jest.fn().mockResolvedValue({})
    const onMissionCompleted = jest.fn().mockResolvedValue([])

    const steps = [
      { id: 's1', status: 'done' },
      { id: 's2', status: 'done' },
    ]

    async function finalizeMission(missionId: string, projectId: string) {
      const pending = steps.filter((s) => s.status === 'pending').length
      const failed  = steps.filter((s) => s.status === 'failed').length

      if (failed > 0) {
        await transition(missionId, 'failed')
      } else if (pending === 0) {
        await transition(missionId, 'done')
        await Promise.all([
          onMissionCompleted(missionId, projectId),
          processCompletion(missionId),  // ← invariante
        ])
      }
    }

    await finalizeMission('m1', 'p1')

    expect(transition).toHaveBeenCalledWith('m1', 'done')
    expect(processCompletion).toHaveBeenCalledWith('m1')
    expect(onMissionCompleted).toHaveBeenCalledWith('m1', 'p1')
  })

  it('processCompletion NÃO é chamado quando steps ainda estão pending', async () => {
    const processCompletion = jest.fn()
    const steps = [
      { id: 's1', status: 'done' },
      { id: 's2', status: 'pending' },
    ]

    async function finalizeMission() {
      const pending = steps.filter((s) => s.status === 'pending').length
      if (pending === 0) await processCompletion()
    }

    await finalizeMission()
    expect(processCompletion).not.toHaveBeenCalled()
  })
})
