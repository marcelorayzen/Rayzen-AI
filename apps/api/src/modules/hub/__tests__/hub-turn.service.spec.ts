import { HttpException, NotFoundException } from '@nestjs/common'
import { HubTurnService, NOTA_DE_CONVERSA_POR_VOZ } from '../hub-turn.service'
import { PROJETO_GERAL_ID } from '../../../common/escopo-geral.const'

describe('HubTurnService — H2 fronteira Rayzen → Hermes', () => {
  const thread = { id: 'thread-general', hermesSessionId: null }

  function setup() {
    const storedEvents: Array<{ sequence: number; type: string; payload: unknown; createdAt: Date }> = []
    const storedTurn = {
      id: 'turn-1', threadId: thread.id, principalId: 'marcelo', idempotencyKey: '', inputText: '',
      createdAt: new Date(), status: 'accepted', outputText: null as string | null,
      errorCode: null as string | null, runtimeRunId: null as string | null,
    }
    const hubTurn = {
      findUnique: jest.fn().mockImplementation(async () => storedTurn.idempotencyKey ? { ...storedTurn } : null),
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation(async ({ data }: { data: Partial<typeof storedTurn> }) => {
        Object.assign(storedTurn, data)
        return { ...storedTurn }
      }),
      update: jest.fn().mockImplementation(async ({ data }: { data: Partial<typeof storedTurn> }) => {
        Object.assign(storedTurn, data)
        return { ...storedTurn }
      }),
      updateMany: jest.fn().mockImplementation(async ({ where, data }: { where: { status: string }; data: Partial<typeof storedTurn> }) => {
        if (storedTurn.status !== where.status) return { count: 0 }
        Object.assign(storedTurn, data)
        return { count: 1 }
      }),
    }
    const prisma = {
      hubTurn,
      hubThread: { update: jest.fn().mockResolvedValue({ ...thread, hermesSessionId: 'session-1' }) },
      hubEvent: {
        create: jest.fn().mockImplementation(async ({ data }: { data: Omit<(typeof storedEvents)[number], 'createdAt'> }) => {
          storedEvents.push({ ...data, createdAt: new Date() })
          return {}
        }),
        findMany: jest.fn().mockImplementation(async () => storedEvents),
      },
    }
    const threads = { resolveActive: jest.fn().mockResolvedValue(thread) }
    const runtime = { sendText: jest.fn().mockResolvedValue({ text: 'resposta', runtimeRunId: 'run-1' }) }
    const contextPacks = { content: jest.fn().mockResolvedValue({ id: 'pack-1', text: 'contexto', snapshotHash: 'hash-1' }) }
    return { service: new HubTurnService(prisma as never, threads as never, runtime as never, contextPacks as never), prisma, threads, runtime, contextPacks, storedTurn }
  }

  it('deriva fio e sessão no servidor; só então envia ao runtime', async () => {
    const { service, prisma, threads, runtime } = setup()

    const result = await service.submit({ principalId: 'marcelo', projectId: null, text: 'olá', idempotencyKey: 'k-1' })

    expect(threads.resolveActive).toHaveBeenCalledWith('marcelo', null)
    expect(prisma.hubThread.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'thread-general' }, data: { hermesSessionId: expect.any(String) },
    }))
    expect(runtime.sendText).toHaveBeenCalledWith(expect.objectContaining({ text: 'olá', idempotencyKey: 'k-1' }))
    expect(result).toMatchObject({ turnId: 'turn-1', threadId: 'thread-general', status: 'completed', outputText: 'resposta' })
    expect(prisma.hubEvent.create).toHaveBeenNthCalledWith(1, expect.objectContaining({
      data: expect.objectContaining({ sequence: 1, type: 'turn.accepted' }),
    }))
  })

  it('não reenvia uma chave idempotente já persistida', async () => {
    const { service, runtime, prisma } = setup()
    prisma.hubTurn.findUnique.mockResolvedValue({
      id: 'turn-old', threadId: thread.id, principalId: 'marcelo', status: 'completed',
      outputText: 'anterior', errorCode: null, runtimeRunId: 'run-old',
    })

    const result = await service.submit({ principalId: 'marcelo', text: 'não duplicar', idempotencyKey: 'same' })

    expect(runtime.sendText).not.toHaveBeenCalled()
    expect(result).toMatchObject({ turnId: 'turn-old', replayed: true, outputText: 'anterior' })
  })

  it('modo async devolve accepted antes do runtime e conclui o turno em segundo plano', async () => {
    const { service, prisma, runtime, storedTurn } = setup()
    let resolveRuntime!: (reply: { text: string; runtimeRunId: string }) => void
    const runtimeReply = new Promise<{ text: string; runtimeRunId: string }>((resolve) => { resolveRuntime = resolve })
    runtime.sendText.mockReturnValue(runtimeReply)
    let resolveCompleted!: () => void
    const completedEvent = new Promise<void>((resolve) => { resolveCompleted = resolve })
    prisma.hubEvent.create.mockImplementation(async ({ data }: { data: { type: string } }) => {
      if (data.type === 'turn.completed') resolveCompleted()
      return {}
    })

    const result = await service.submit({ principalId: 'marcelo', text: 'olá', idempotencyKey: 'async-1', modo: 'async' })

    expect(result).toMatchObject({ turnId: 'turn-1', status: 'accepted', outputText: null })
    expect(runtime.sendText).toHaveBeenCalledTimes(1)
    expect(storedTurn.status).toBe('accepted')
    expect(prisma.hubEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ sequence: 1, type: 'turn.accepted' }),
    }))
    resolveRuntime({ text: 'resposta async', runtimeRunId: 'run-async' })
    await completedEvent

    expect(storedTurn).toMatchObject({ status: 'completed', outputText: 'resposta async', runtimeRunId: 'run-async' })
  })

  it('modo async persiste falha do runtime e preserva idempotência durante a execução', async () => {
    const { service, prisma, runtime, storedTurn } = setup()
    let rejectRuntime!: (error: Error) => void
    runtime.sendText.mockReturnValue(new Promise((_, reject) => { rejectRuntime = reject }))
    let resolveFailed!: () => void
    const failedEvent = new Promise<void>((resolve) => { resolveFailed = resolve })
    prisma.hubEvent.create.mockImplementation(async ({ data }: { data: { type: string } }) => {
      if (data.type === 'turn.failed') resolveFailed()
      return {}
    })

    const accepted = await service.submit({ principalId: 'marcelo', text: 'olá', idempotencyKey: 'async-2', modo: 'async' })
    const replay = await service.submit({ principalId: 'marcelo', text: 'duplicar', idempotencyKey: 'async-2', modo: 'async' })
    expect(replay).toMatchObject({ turnId: 'turn-1', status: 'accepted', replayed: true })
    expect(runtime.sendText).toHaveBeenCalledTimes(1)

    rejectRuntime(new Error('runtime indisponível'))
    await failedEvent
    expect(accepted.status).toBe('accepted')
    expect(storedTurn).toMatchObject({ status: 'failed', errorCode: 'hub_runtime_failed' })
  })

  it('não revela eventos de outro principal', async () => {
    const { service, prisma } = setup()
    prisma.hubTurn.findUnique.mockResolvedValue({
      id: 'turn-foreign', threadId: thread.id, principalId: 'outra-pessoa', status: 'completed',
      outputText: null, errorCode: null, runtimeRunId: null,
    })

    await expect(service.events('marcelo', 'turn-foreign')).rejects.toBeInstanceOf(NotFoundException)
    expect(prisma.hubEvent.findMany).not.toHaveBeenCalled()
  })

  it('não revela um turno de outro principal', async () => {
    const { service, prisma } = setup()
    prisma.hubTurn.findUnique.mockResolvedValue({
      id: 'turn-foreign', threadId: thread.id, principalId: 'outra-pessoa', status: 'completed',
      outputText: 'privado', errorCode: null, runtimeRunId: null,
    })

    await expect(service.get('marcelo', 'turn-foreign')).rejects.toBeInstanceOf(NotFoundException)
  })

  it('marca turno aceito antigo como interrompido e grava o próximo evento', async () => {
    const { service, prisma, storedTurn } = setup()
    storedTurn.idempotencyKey = 'accepted'
    storedTurn.createdAt = new Date(Date.now() - 700_000)

    await expect(service.get('marcelo', 'turn-1')).resolves.toMatchObject({
      status: 'failed', errorCode: 'hub_turn_interrupted',
    })
    expect(prisma.hubTurn.updateMany).toHaveBeenCalledWith({
      where: { id: 'turn-1', status: 'accepted' },
      data: expect.objectContaining({ status: 'failed', errorCode: 'hub_turn_interrupted' }),
    })
    expect(prisma.hubEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        turnId: 'turn-1', sequence: 2, type: 'turn.failed',
        payload: { code: 'hub_turn_interrupted' },
      }),
    })
  })

  it('também finaliza turno antigo ao consultar seus eventos', async () => {
    const { service, prisma, storedTurn } = setup()
    storedTurn.idempotencyKey = 'accepted'
    storedTurn.createdAt = new Date(Date.now() - 700_000)

    await expect(service.events('marcelo', 'turn-1')).resolves.toMatchObject({
      events: [expect.objectContaining({ sequence: 2, type: 'turn.failed', payload: { code: 'hub_turn_interrupted' } })],
    })
  })

  it('mantém accepted enquanto o turno ainda está dentro do limite', async () => {
    const { service, prisma, storedTurn } = setup()
    storedTurn.idempotencyKey = 'accepted'

    await expect(service.events('marcelo', 'turn-1')).resolves.toMatchObject({ turnId: 'turn-1', events: [] })
    expect(prisma.hubTurn.updateMany).not.toHaveBeenCalled()
    expect(prisma.hubEvent.create).not.toHaveBeenCalled()
  })

  it('não grava falha se a execução concluir antes da transição condicional', async () => {
    const { service, prisma, storedTurn } = setup()
    storedTurn.idempotencyKey = 'accepted'
    storedTurn.createdAt = new Date(Date.now() - 700_000)
    prisma.hubTurn.updateMany.mockResolvedValue({ count: 0 })
    prisma.hubTurn.findUnique
      .mockResolvedValueOnce({ ...storedTurn, status: 'accepted' })
      .mockResolvedValueOnce({ ...storedTurn, status: 'completed', outputText: 'resposta' })

    await expect(service.get('marcelo', 'turn-1')).resolves.toMatchObject({
      status: 'completed', outputText: 'resposta',
    })
    expect(prisma.hubEvent.create).not.toHaveBeenCalled()
  })
})

describe('HubTurnService — o fio diz ao runtime de que projeto ele é (item 7.5)', () => {
  function setup(thread: { id: string; hermesSessionId: string | null; projectId: string | null }, projeto: { name: string } | null | 'falha') {
    const turno = { id: 't1', threadId: thread.id, principalId: 'marcelo', idempotencyKey: 'k', inputText: 'x', status: 'accepted', outputText: null, errorCode: null, runtimeRunId: null }
    const prisma = {
      hubTurn: {
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(turno),
        update: jest.fn().mockResolvedValue({ ...turno, status: 'completed', outputText: 'r' }),
      },
      hubThread: { update: jest.fn().mockResolvedValue(thread) },
      hubEvent: { create: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
      project: { findUnique: jest.fn(async () => { if (projeto === 'falha') throw new Error('db'); return projeto }) },
    }
    const runtime = { sendText: jest.fn().mockResolvedValue({ text: 'r', runtimeRunId: 'run' }) }
    const contextPacks = { content: jest.fn().mockResolvedValue({ id: 'pack-1', text: 'CONTEXTO-DO-PACK', snapshotHash: 'h' }) }
    const service = new HubTurnService(prisma as never, { resolveActive: jest.fn().mockResolvedValue(thread) } as never, runtime as never, contextPacks as never)
    return { service, runtime, prisma }
  }

  // HC7c (23/11): no modo conversa a resposta é falada; a nota pede resposta curta.
  it('porVoz: a nota de resposta curta entra no contexto, depois do escopo e antes do pack', async () => {
    const { service, runtime } = setup({ id: 'th', hermesSessionId: 's1', projectId: 'proj-m' }, { name: 'curso' })
    await service.submit({ principalId: 'marcelo', projectId: 'proj-m', text: 'explica o capítulo dois', contextPackId: 'pack-1', porVoz: true })
    const { context, text } = runtime.sendText.mock.calls[0][0]
    expect(context).toContain(NOTA_DE_CONVERSA_POR_VOZ)
    expect(context.indexOf('[ESCOPO DO FIO]')).toBeLessThan(context.indexOf('[MODO CONVERSA POR VOZ]'))
    expect(context.indexOf('[MODO CONVERSA POR VOZ]')).toBeLessThan(context.indexOf('CONTEXTO-DO-PACK'))
    // O pedido da pessoa segue intacto: a nota muda a forma, não o que foi pedido.
    expect(text).toBe('explica o capítulo dois')
  })

  it('sem porVoz, nenhuma nota de voz: o texto do Hub não encurta', async () => {
    const { service, runtime } = setup({ id: 'th', hermesSessionId: 's1', projectId: 'proj-m' }, { name: 'curso' })
    await service.submit({ principalId: 'marcelo', projectId: 'proj-m', text: 'x', contextPackId: 'pack-1' })
    expect(runtime.sendText.mock.calls[0][0].context).not.toContain('[MODO CONVERSA POR VOZ]')
  })

  it('porVoz fica registrado no evento de aceite do turno', async () => {
    const { service, prisma } = setup({ id: 'th', hermesSessionId: 's1', projectId: 'proj-m' }, { name: 'curso' })
    await service.submit({ principalId: 'marcelo', projectId: 'proj-m', text: 'x', porVoz: true })
    const aceite = prisma.hubEvent.create.mock.calls.find(([a]: [{ data: { type: string } }]) => a.data.type === 'turn.accepted')
    expect(aceite?.[0].data.payload).toMatchObject({ porVoz: true })
  })

  it('fio de projeto: o system leva o projectId e o nome, antes do ContextPack', async () => {
    const { service, runtime } = setup({ id: 'th', hermesSessionId: 's1', projectId: 'proj-m' }, { name: 'rayzen-marcenaria' })
    await service.submit({ principalId: 'marcelo', projectId: 'proj-m', text: 'liste os arquivos', contextPackId: 'pack-1' })
    const { context } = runtime.sendText.mock.calls[0][0]
    expect(context).toMatch(/\[ESCOPO DO FIO\] Este fio pertence ao projeto "rayzen-marcenaria" \(projectId=proj-m\)/)
    expect(context).toMatch(/passe projectId="proj-m"/)
    expect(context.indexOf('[ESCOPO DO FIO]')).toBeLessThan(context.indexOf('CONTEXTO-DO-PACK'))
  })

  it('fio do Geral: declara que nenhum projeto está assumido', async () => {
    const { service, runtime } = setup({ id: 'th', hermesSessionId: 's1', projectId: PROJETO_GERAL_ID }, null)
    await service.submit({ principalId: 'marcelo', projectId: null, text: 'oi' })
    expect(runtime.sendText.mock.calls[0][0].context).toMatch(/Escopo Geral: nenhum projeto está assumido/)
  })

  it('falha ao ler o nome não derruba o turno: o id basta', async () => {
    const { service, runtime } = setup({ id: 'th', hermesSessionId: 's1', projectId: 'proj-m' }, 'falha')
    await expect(service.submit({ principalId: 'marcelo', projectId: 'proj-m', text: 'x' })).resolves.toMatchObject({ status: 'completed' })
    expect(runtime.sendText.mock.calls[0][0].context).toMatch(/\(projectId=proj-m\)/)
  })
})

// 13/11: o Geral tinha 53 mensagens numa sessão Hermes só, e o Hermes congela a lista de
// ferramentas por sessão — `rayzen_propose_project` nunca chegava ao modelo.
describe('HubTurnService — a sessão do Hermes se renova, o fio continua', () => {
  const MIN = 60_000
  function setup(ultimoTurno: Date | null | 'falha') {
    const thread = { id: 'th', hermesSessionId: 'sessao-velha', projectId: null }
    const turno = { id: 't1', threadId: 'th', principalId: 'marcelo', idempotencyKey: 'k', inputText: 'oi', status: 'accepted', outputText: null, errorCode: null, runtimeRunId: null }
    const prisma = {
      hubTurn: {
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn(async () => {
          if (ultimoTurno === 'falha') throw new Error('db')
          return ultimoTurno ? { createdAt: ultimoTurno } : null
        }),
        create: jest.fn().mockResolvedValue(turno),
        update: jest.fn().mockResolvedValue({ ...turno, status: 'completed', outputText: 'r' }),
      },
      hubThread: { update: jest.fn().mockResolvedValue(thread) },
      hubEvent: { create: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
    }
    const runtime = { sendText: jest.fn().mockResolvedValue({ text: 'r', runtimeRunId: 'run' }) }
    const service = new HubTurnService(prisma as never, { resolveActive: jest.fn().mockResolvedValue(thread) } as never, runtime as never, { content: jest.fn() } as never)
    const sessaoUsada = () => runtime.sendText.mock.calls[0][0].sessionId as string
    const aceito = () => prisma.hubEvent.create.mock.calls[0][0].data.payload
    return { service, prisma, sessaoUsada, aceito }
  }

  it('conversa em andamento (dentro da janela) continua na mesma sessão', async () => {
    const { service, prisma, sessaoUsada, aceito } = setup(new Date(Date.now() - 5 * MIN))
    await service.submit({ principalId: 'marcelo', text: 'oi' })
    expect(sessaoUsada()).toBe('sessao-velha')
    expect(prisma.hubThread.update).not.toHaveBeenCalled()
    expect(aceito()).not.toHaveProperty('sessaoNova')
  })

  it('parado além da janela: sessão nova, gravada no fio e registrada no turno', async () => {
    const { service, prisma, sessaoUsada, aceito } = setup(new Date(Date.now() - 45 * MIN))
    await service.submit({ principalId: 'marcelo', text: 'oi' })
    expect(sessaoUsada()).not.toBe('sessao-velha')
    expect(prisma.hubThread.update).toHaveBeenCalledWith({ where: { id: 'th' }, data: { hermesSessionId: sessaoUsada() } })
    expect(aceito()).toMatchObject({ sessaoNova: 'inatividade' })
  })

  it('"+ Nova conversa" renova mesmo dentro da janela', async () => {
    const { service, sessaoUsada, aceito } = setup(new Date(Date.now() - 1 * MIN))
    await service.submit({ principalId: 'marcelo', text: 'oi', novaConversa: true })
    expect(sessaoUsada()).not.toBe('sessao-velha')
    expect(aceito()).toMatchObject({ sessaoNova: 'nova_conversa' })
  })

  it('falha ao ler o último turno mantém a sessão em vez de derrubar o turno', async () => {
    const { service, sessaoUsada } = setup('falha')
    await expect(service.submit({ principalId: 'marcelo', text: 'oi' })).resolves.toMatchObject({ status: 'completed' })
    expect(sessaoUsada()).toBe('sessao-velha')
  })
})

describe('HubTurnService — fila de turnos por fio', () => {
  type StoredTurn = {
    id: string
    threadId: string
    principalId: string
    idempotencyKey: string
    inputText: string
    createdAt: Date
    status: string
    outputText: string | null
    errorCode: string | null
    runtimeRunId: string | null
  }

  function setup() {
    let proximoTurno = 0
    const turnos = new Map<string, StoredTurn>()
    const eventos: Array<{ turnId: string; sequence: number; type: string; payload: unknown; createdAt: Date }> = []
    const fios = new Map<string, { id: string; hermesSessionId: string; projectId: string }>()
    const chaveIdempotencia = (threadId: string, key: string) => `${threadId}:${key}`

    const hubTurn = {
      findUnique: jest.fn(async ({ where }: {
        where: { id?: string; threadId_idempotencyKey?: { threadId: string; idempotencyKey: string } }
      }) => {
        if (where.id) {
          const turn = turnos.get(where.id)
          return turn ? { ...turn } : null
        }
        const key = where.threadId_idempotencyKey
        if (!key) return null
        const id = chaveIdempotencia(key.threadId, key.idempotencyKey)
        const turn = turnos.get(id)
        return turn ? { ...turn } : null
      }),
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn(async ({ data }: { data: Omit<StoredTurn, 'id' | 'createdAt' | 'outputText' | 'errorCode' | 'runtimeRunId'> }) => {
        const id = `turn-${++proximoTurno}`
        const turn: StoredTurn = {
          ...data, id, createdAt: new Date(), outputText: null, errorCode: null, runtimeRunId: null,
        }
        turnos.set(id, turn)
        turnos.set(chaveIdempotencia(turn.threadId, turn.idempotencyKey), turn)
        return { ...turn }
      }),
      update: jest.fn(async ({ where, data }: { where: { id: string }; data: Partial<StoredTurn> }) => {
        const turn = turnos.get(where.id)!
        Object.assign(turn, data)
        return { ...turn }
      }),
      updateMany: jest.fn(async ({ where, data }: { where: { id: string; status: string }; data: Partial<StoredTurn> }) => {
        const turn = turnos.get(where.id)
        if (!turn || turn.status !== where.status) return { count: 0 }
        Object.assign(turn, data)
        return { count: 1 }
      }),
    }
    const prisma = {
      hubTurn,
      hubThread: {
        update: jest.fn(async ({ where, data }: { where: { id: string }; data: { hermesSessionId: string } }) => {
          const thread = [...fios.values()].find((item) => item.id === where.id)!
          Object.assign(thread, data)
          return { ...thread }
        }),
      },
      hubEvent: {
        create: jest.fn(async ({ data }: { data: Omit<(typeof eventos)[number], 'createdAt'> }) => {
          eventos.push({ ...data, createdAt: new Date() })
          return {}
        }),
        findMany: jest.fn(async ({ where }: { where: { turnId: string } }) =>
          eventos.filter((event) => event.turnId === where.turnId)),
      },
      project: { findUnique: jest.fn().mockResolvedValue(null) },
    }
    const threads = {
      resolveActive: jest.fn(async (_principalId: string, projectId?: string | null) => {
        const key = projectId ?? 'general'
        let thread = fios.get(key)
        if (!thread) {
          thread = { id: `thread-${key}`, hermesSessionId: `session-${key}`, projectId: key }
          fios.set(key, thread)
        }
        return { ...thread }
      }),
    }
    const runtime = { sendText: jest.fn().mockResolvedValue({ text: 'resposta', runtimeRunId: 'run' }) }
    const contextPacks = { content: jest.fn() }
    const service = new HubTurnService(
      prisma as never, threads as never, runtime as never, contextPacks as never,
    )
    return { service, prisma, runtime, turnos, eventos }
  }

  it('executa dois turnos async do mesmo fio na ordem, aguardando a conclusão do primeiro', async () => {
    const { service, prisma, runtime, eventos } = setup()
    let concluirPrimeiro!: (reply: { text: string; runtimeRunId: string }) => void
    let concluirSegundo!: (reply: { text: string; runtimeRunId: string }) => void
    let iniciarSegundo!: () => void
    let concluirAmbos!: () => void
    const segundoIniciado = new Promise<void>((resolve) => { iniciarSegundo = resolve })
    const ambosConcluidos = new Promise<void>((resolve) => { concluirAmbos = resolve })
    runtime.sendText.mockImplementation(({ text }: { text: string }) => {
      if (text === 'primeiro') {
        return new Promise((resolve) => { concluirPrimeiro = resolve })
      }
      iniciarSegundo()
      expect(eventos.some((event) => event.turnId === 'turn-1' && event.type === 'turn.completed')).toBe(true)
      return new Promise((resolve) => { concluirSegundo = resolve })
    })
    prisma.hubEvent.create.mockImplementation(async ({ data }: { data: { turnId: string; type: string } }) => {
      eventos.push({ ...data, sequence: 2, payload: {}, createdAt: new Date() })
      if (eventos.filter((event) => event.type === 'turn.completed').length === 2) concluirAmbos()
      return {}
    })

    const primeiro = await service.submit({ principalId: 'marcelo', text: 'primeiro', idempotencyKey: 'fila-1', modo: 'async' })
    const segundo = await service.submit({ principalId: 'marcelo', text: 'segundo', idempotencyKey: 'fila-2', modo: 'async' })

    expect(primeiro).toMatchObject({ inputText: 'primeiro' })
    expect(segundo).toMatchObject({ inputText: 'segundo' })
    expect(runtime.sendText).toHaveBeenCalledTimes(1)
    concluirPrimeiro({ text: 'resposta 1', runtimeRunId: 'run-1' })
    await segundoIniciado
    expect(runtime.sendText.mock.calls.map(([args]) => args.text)).toEqual(['primeiro', 'segundo'])
    concluirSegundo({ text: 'resposta 2', runtimeRunId: 'run-2' })
    await ambosConcluidos
  })

  it('continua a fila depois que um turno falha', async () => {
    const { service, prisma, runtime, eventos } = setup()
    let falharPrimeiro!: (error: Error) => void
    let concluirSegundo!: (reply: { text: string; runtimeRunId: string }) => void
    let iniciarSegundo!: () => void
    let finalizar!: () => void
    const segundoIniciado = new Promise<void>((resolve) => { iniciarSegundo = resolve })
    const finalizado = new Promise<void>((resolve) => { finalizar = resolve })
    runtime.sendText.mockImplementation(({ text }: { text: string }) => {
      if (text === 'primeiro') return new Promise((_, reject) => { falharPrimeiro = reject })
      iniciarSegundo()
      expect(eventos.some((event) => event.turnId === 'turn-1' && event.type === 'turn.failed')).toBe(true)
      return new Promise((resolve) => { concluirSegundo = resolve })
    })
    prisma.hubEvent.create.mockImplementation(async ({ data }: { data: { turnId: string; type: string } }) => {
      eventos.push({ ...data, sequence: 2, payload: {}, createdAt: new Date() })
      if (data.type === 'turn.completed') finalizar()
      return {}
    })

    await service.submit({ principalId: 'marcelo', text: 'primeiro', idempotencyKey: 'falha-1', modo: 'async' })
    await service.submit({ principalId: 'marcelo', text: 'segundo', idempotencyKey: 'falha-2', modo: 'async' })
    falharPrimeiro(new Error('runtime indisponível'))
    await segundoIniciado
    expect(runtime.sendText.mock.calls.map(([args]) => args.text)).toEqual(['primeiro', 'segundo'])
    concluirSegundo({ text: 'resposta 2', runtimeRunId: 'run-2' })
    await finalizado
  })

  it('inclui execuções síncronas na mesma fila do fio', async () => {
    const { service, runtime } = setup()
    let iniciarPrimeiro!: () => void
    let concluirPrimeiro!: (reply: { text: string; runtimeRunId: string }) => void
    let iniciarSegundo!: () => void
    const primeiroIniciado = new Promise<void>((resolve) => { iniciarPrimeiro = resolve })
    const segundoIniciado = new Promise<void>((resolve) => { iniciarSegundo = resolve })
    runtime.sendText.mockImplementation(({ text }: { text: string }) => {
      if (text === 'síncrono') {
        return new Promise((resolve) => { concluirPrimeiro = resolve; iniciarPrimeiro() })
      }
      iniciarSegundo()
      return Promise.resolve({ text: 'resposta async', runtimeRunId: 'run-2' })
    })

    const primeiro = service.submit({ principalId: 'marcelo', text: 'síncrono', idempotencyKey: 'sync-1' })
    await primeiroIniciado
    await service.submit({ principalId: 'marcelo', text: 'async', idempotencyKey: 'sync-2', modo: 'async' })

    expect(runtime.sendText).toHaveBeenCalledTimes(1)
    concluirPrimeiro({ text: 'resposta sync', runtimeRunId: 'run-1' })
    await primeiro
    await segundoIniciado
    expect(runtime.sendText.mock.calls.map(([args]) => args.text)).toEqual(['síncrono', 'async'])
  })

  it('executa fios diferentes em paralelo', async () => {
    const { service, runtime } = setup()
    let iniciarAmbos!: () => void
    const ambosIniciados = new Promise<void>((resolve) => { iniciarAmbos = resolve })
    const resolvers: Array<(reply: { text: string; runtimeRunId: string }) => void> = []
    runtime.sendText.mockImplementation(() => {
      const promessa = new Promise<{ text: string; runtimeRunId: string }>((resolve) => { resolvers.push(resolve) })
      if (resolvers.length === 2) iniciarAmbos()
      return promessa
    })

    await service.submit({ principalId: 'marcelo', projectId: 'projeto-a', text: 'a', idempotencyKey: 'paralelo-a', modo: 'async' })
    await service.submit({ principalId: 'marcelo', projectId: 'projeto-b', text: 'b', idempotencyKey: 'paralelo-b', modo: 'async' })
    await ambosIniciados

    expect(runtime.sendText).toHaveBeenCalledTimes(2)
    resolvers.forEach((resolve, index) => resolve({ text: `resposta ${index}`, runtimeRunId: `run-${index}` }))
  })

  it('não interrompe turno antigo que ainda está na fila deste processo', async () => {
    const { service, prisma, runtime, turnos } = setup()
    let iniciarRuntime!: () => void
    let concluirRuntime!: (reply: { text: string; runtimeRunId: string }) => void
    const runtimeIniciado = new Promise<void>((resolve) => { iniciarRuntime = resolve })
    runtime.sendText.mockImplementation(() =>
      new Promise((resolve) => { concluirRuntime = resolve; iniciarRuntime() }))

    await service.submit({ principalId: 'marcelo', text: 'longo', idempotencyKey: 'antigo', modo: 'async' })
    await runtimeIniciado
    turnos.get('turn-1')!.createdAt = new Date(Date.now() - 700_000)

    await expect(service.get('marcelo', 'turn-1')).resolves.toMatchObject({ status: 'accepted' })
    expect(prisma.hubTurn.updateMany).not.toHaveBeenCalled()
    expect(prisma.hubEvent.create).not.toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ type: 'turn.failed' }),
    }))
    concluirRuntime({ text: 'pronto', runtimeRunId: 'run-1' })
  })

  it('recusa o sexto turno aguardando antes de criar a linha', async () => {
    const { service, prisma, runtime } = setup()
    let iniciarRuntime!: () => void
    let concluirRuntime!: (reply: { text: string; runtimeRunId: string }) => void
    let concluirFila!: () => void
    const runtimeIniciado = new Promise<void>((resolve) => { iniciarRuntime = resolve })
    const filaConcluida = new Promise<void>((resolve) => { concluirFila = resolve })
    runtime.sendText.mockImplementation(({ text }: { text: string }) => {
      if (text !== 'rodando') return Promise.resolve({ text: 'resposta', runtimeRunId: 'run' })
      return new Promise((resolve) => { concluirRuntime = resolve; iniciarRuntime() })
    })
    prisma.hubEvent.create.mockImplementation(async ({ data }: { data: { turnId: string; type: string } }) => {
      if (data.turnId === 'turn-6' && data.type === 'turn.completed') concluirFila()
      return {}
    })

    await service.submit({ principalId: 'marcelo', text: 'rodando', idempotencyKey: 'limite-0', modo: 'async' })
    await runtimeIniciado
    for (let index = 1; index <= 5; index += 1) {
      await service.submit({ principalId: 'marcelo', text: `aguardando ${index}`, idempotencyKey: `limite-${index}`, modo: 'async' })
    }

    const rejeitado = service.submit({ principalId: 'marcelo', text: 'sexto aguardando', idempotencyKey: 'limite-6', modo: 'async' })
      .catch((error: unknown) => error)
    const error = await rejeitado
    expect(error).toBeInstanceOf(HttpException)
    expect((error as HttpException).getStatus()).toBe(429)
    expect((error as HttpException).getResponse()).toEqual({ code: 'hub_turn_queue_full' })
    expect(prisma.hubTurn.create).toHaveBeenCalledTimes(6)
    concluirRuntime({ text: 'pronto', runtimeRunId: 'run-0' })
    await filaConcluida
  })
})
