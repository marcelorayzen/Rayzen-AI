import { OrchestratorService } from '../orchestrator.service'

/**
 * ── A07 da auditoria de 13/09 ─────────────────────────────────────────────────
 *
 * A janela do histórico era `orderBy: { createdAt: 'asc' }, take: 20` — as **vinte PRIMEIRAS**
 * mensagens da sessão, em dois pontos do serviço (chat comum e streaming).
 *
 * Numa conversa curta é indistinguível do correto, e é por isso que passou. Acima de vinte
 * mensagens, o prompt congela no começo do papo e **ignora tudo o que veio depois**: uma
 * instrução que substitui outra nunca chega ao modelo, e a correção mais recente é exatamente a
 * que fica de fora — o pior recorte possível para uma conversa que está sendo ajustada.
 */
describe('janelaDeHistorico — as ÚLTIMAS mensagens, em ordem cronológica', () => {
  function build(linhas: { role: string; content: string }[]) {
    const findMany = jest.fn().mockResolvedValue(linhas)
    const svc = Object.create(OrchestratorService.prototype) as OrchestratorService
    Object.assign(svc, { prisma: { conversationMessage: { findMany } } })
    const chamar = (sessionId: string, projectId?: string) =>
      (svc as unknown as {
        janelaDeHistorico: (s: string, p?: string) => Promise<{ role: string; content: string }[]>
      }).janelaDeHistorico(sessionId, projectId)
    return { chamar, findMany }
  }

  it('busca em ordem decrescente — senão pega o começo da conversa', async () => {
    const { chamar, findMany } = build([])

    await chamar('sess-1', 'proj-1')

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: { createdAt: 'desc' },
        take: 20,
        where: { sessionId: 'sess-1', projectId: 'proj-1' },
      }),
    )
  })

  /**
   * O banco devolve do mais novo para o mais velho; o prompt precisa do contrário. Sem a
   * reversão, a conversa chegaria ao modelo de trás para frente — que erra de um jeito mais
   * difícil de perceber do que a janela errada.
   */
  it('devolve em ordem cronológica, do mais antigo para o mais recente', async () => {
    const { chamar } = build([
      { role: 'user', content: 'terceira' },
      { role: 'user', content: 'segunda' },
      { role: 'user', content: 'primeira' },
    ])

    const r = await chamar('sess-1')

    expect(r.map((m) => m.content)).toEqual(['primeira', 'segunda', 'terceira'])
  })

  it('sem projectId, não filtra por projeto', async () => {
    const { chamar, findMany } = build([])

    await chamar('sess-1')

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { sessionId: 'sess-1' } }),
    )
  })
})
