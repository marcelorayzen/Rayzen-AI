import { DocumentationService } from '../documentation.service'

/**
 * `force` respondia DUAS perguntas diferentes com um flag so.
 *
 * "Ignore a protecao de documento revisado a mao" e "regenere mesmo estando fresco"
 * sao decisoes distintas, e o caminho automatico so precisa da primeira. Como havia
 * um flag unico, o `SmartCheckpointService` — que roda a cada 10min e precisa mesmo
 * sobrescrever documento revisado — levava o bypass de frescor de carona.
 *
 * O desequilibrio: estes documentos sao rollup de 30 DIAS. Em 10 minutos entram ~5
 * eventos numa janela de 60 (~92% da entrada e a mesma) e o documento e reescrito
 * inteiro. Medido em 7 dias: `project_state` teve 74 versoes e ZERO byte-identicas —
 * o LLM reformula sempre, entao "so grave se mudou" nao evita a chamada. Piso de
 * tempo e o unico gate que evita.
 */
describe('DocumentationService — piso de frescor', () => {
  const UMA_HORA = 60 * 60 * 1000

  function build(geradoHaMs: number, reviewedAt: Date | null = null) {
    const create = jest.fn()
    const prisma = {
      project:         { findUnique: jest.fn().mockResolvedValue({ id: 'p1', name: 'P' }) },
      projectDocument: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'doc1', type: 'project_state', content: 'conteudo atual',
          generatedAt: new Date(Date.now() - geradoHaMs), reviewedAt,
        }),
      },
      sessionArtifact:      { findMany: jest.fn().mockResolvedValue([]) },
      event:                { findMany: jest.fn().mockResolvedValue([]) },
      projectState:         { findUnique: jest.fn().mockResolvedValue(null) },
      projectGoal:          { findFirst: jest.fn().mockResolvedValue(null) },
      conversationMessage:  { create: create.mockResolvedValue({}) },
    }
    const llmCreate = jest.fn()
    const svc = new DocumentationService(
      prisma as never,
      { get: jest.fn().mockReturnValue('x') } as never,
      { refresh: jest.fn().mockResolvedValue(null) } as never,
      { llmTokensTotal: { inc: jest.fn() }, llmRequestDuration: { observe: jest.fn() } } as never,
    )
    ;(svc as unknown as { llm: unknown }).llm = { chat: { completions: { create: llmCreate } } }
    return { svc, llmCreate }
  }

  it('documento de 10min NAO vai ao LLM — devolve o atual', async () => {
    const { svc, llmCreate } = build(10 * 60 * 1000)

    const r = await svc.generate('p1', 'project_state', { force: true })

    expect(llmCreate).not.toHaveBeenCalled()
    expect(r.content).toBe('conteudo atual')
  })

  /**
   * `force: true` sozinho NAO fura o piso — essa e a separacao inteira. E o que o
   * caminho automatico passa, e o teste falharia se alguem reunisse os dois flags.
   */
  it('force sozinho nao fura o piso', async () => {
    const { svc, llmCreate } = build(5 * 60 * 1000)
    await svc.generate('p1', 'project_state', { force: true })
    expect(llmCreate).not.toHaveBeenCalled()
  })

  it('ignorarFrescor fura o piso — e o que o pedido humano usa', async () => {
    const { svc, llmCreate } = build(5 * 60 * 1000)
    llmCreate.mockResolvedValue({ choices: [{ message: { content: 'novo' } }], usage: { total_tokens: 10 } })

    await svc.generate('p1', 'project_state', { force: true, ignorarFrescor: true }).catch(() => null)

    expect(llmCreate).toHaveBeenCalled()
  })

  it('passado o piso, regenera sem precisar de bypass nenhum', async () => {
    const { svc, llmCreate } = build(UMA_HORA + 60_000)
    llmCreate.mockResolvedValue({ choices: [{ message: { content: 'novo' } }], usage: { total_tokens: 10 } })

    await svc.generate('p1', 'project_state', {}).catch(() => null)

    expect(llmCreate).toHaveBeenCalled()
  })

  /**
   * A protecao de revisao manual e avaliada ANTES do piso e continua sendo erro, nao
   * um retorno silencioso do documento atual: quem chama sem `force` precisa saber que
   * existe conteudo humano ali. Devolver o documento calado esconderia isso.
   */
  it('documento revisado a mao sem force continua lancando, nao devolvendo', async () => {
    const { svc } = build(UMA_HORA + 60_000, new Date())
    await expect(svc.generate('p1', 'project_state', {})).rejects.toThrow(/revisado manualmente/)
  })
})
