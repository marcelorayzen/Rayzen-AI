import { SessionService } from '../session.service'
import { PROJETO_GERAL_ID } from '../../../common/escopo-geral.const'

/**
 * Item 7.5 — o fio do Hub decide em que projeto a conversa espelhada pelo hook do Hermes mora.
 *
 * Medido em 12/11: dois turnos do fio `rayzen-marcenaria` chegaram ao `conversation_messages`
 * do GERAL, porque o `post_llm_call` não sabe de que fio veio o turno. A sessão Hermes de cada
 * fio está em `hub_threads.hermes_session_id`, então o servidor resolve sozinho.
 */
function montar(fio: { projectId: string | null } | null | 'falha') {
  const gravadas: Array<{ projectId: string }> = []
  const prisma = {
    hubThread: {
      findFirst: jest.fn(async () => {
        if (fio === 'falha') throw new Error('db fora')
        return fio
      }),
    },
    conversationMessage: {
      createMany: jest.fn(async ({ data }: { data: Array<{ projectId: string }> }) => {
        gravadas.push(...data)
        return { count: data.length }
      }),
    },
    event: { create: jest.fn().mockResolvedValue({}) },
  }
  return { svc: new SessionService(prisma as never), prisma, gravadas }
}

const TURNO = { sessionId: '19248338-4980-4b6a-9436-1c99de31daec', userMessage: 'liste os arquivos', assistantResponse: 'ok' }

describe('ingerirTurnoDoHub — o dono vem do fio, não do hook', () => {
  it('sessão de um fio de projeto grava NAQUELE projeto, mesmo sem projectId do hook', async () => {
    const { svc, prisma, gravadas } = montar({ projectId: 'proj-marcenaria' })
    await svc.ingerirTurnoDoHub(TURNO)
    expect(prisma.hubThread.findFirst).toHaveBeenCalledWith({
      where: { hermesSessionId: TURNO.sessionId }, select: { projectId: true },
    })
    expect(gravadas.map((m) => m.projectId)).toEqual(['proj-marcenaria', 'proj-marcenaria'])
  })

  it('o fio vence um projectId divergente vindo do hook', async () => {
    const { svc, gravadas } = montar({ projectId: 'proj-marcenaria' })
    await svc.ingerirTurnoDoHub({ ...TURNO, projectId: 'proj-errado' })
    expect(gravadas[0].projectId).toBe('proj-marcenaria')
  })

  it('fio do GERAL também decide: o projeto do hook não passa por cima dele', async () => {
    const { svc, gravadas } = montar({ projectId: null })
    await svc.ingerirTurnoDoHub({ ...TURNO, projectId: 'proj-qualquer' })
    expect(gravadas[0].projectId).toBe(PROJETO_GERAL_ID)
  })

  it('sem fio (Dashboard Hermes direto) mantém o comportamento anterior', async () => {
    const { svc, gravadas } = montar(null)
    await svc.ingerirTurnoDoHub({ ...TURNO, projectId: 'proj-do-hook' })
    expect(gravadas[0].projectId).toBe('proj-do-hook')
    const semNada = montar(null)
    await semNada.svc.ingerirTurnoDoHub(TURNO)
    expect(semNada.gravadas[0].projectId).toBe(PROJETO_GERAL_ID)
  })

  it('falha ao ler o fio não inventa dono e não derruba a ingestão', async () => {
    const { svc, gravadas } = montar('falha')
    await expect(svc.ingerirTurnoDoHub(TURNO)).resolves.toMatchObject({ gravado: true })
    expect(gravadas[0].projectId).toBe(PROJETO_GERAL_ID)
  })
})
