import { SessionService } from '../session.service'
import { OrchestratorController } from '../../orchestrator/orchestrator.controller'
import { PROJETO_GERAL_ID } from '../../../common/escopo-geral.const'

/**
 * ── A regra estava certa e valia num canto só ───────────────────────────────
 *
 * `pareceDecisao` → `event type:'decision'` nasceu dentro de `ingerirTurnoDoHub` (18/09) e
 * funcionava. O que ninguém tinha olhado é que a **mesma frase**, dita no chat da web ou no
 * Telegram, não chegava à timeline de projeto nenhum — e os três canais são o mesmo cérebro, a
 * mesma identidade e, desde 18/09, o mesmo fio de conversa.
 *
 * É a família de `ehTextoDerivadoDeEvento` (escrita mas aplicada só na escrita) e das quatro
 * `SAFE_ROOTS` divergentes. Aqui não há cópia: uma função, chamada de dois lugares.
 */

const fakePrisma = (opts: { falhaAoCriar?: boolean } = {}) => {
  const eventos: Array<Record<string, unknown>> = []
  return {
    prisma: {
      conversationMessage: { createMany: async () => ({ count: 2 }) },
      event: {
        create: async (a: { data: Record<string, unknown> }) => {
          if (opts.falhaAoCriar) throw new Error('banco fora')
          eventos.push(a.data)
          return {}
        },
      },
    },
    eventos,
  }
}

const svcCom = (p: ReturnType<typeof fakePrisma>) => new SessionService(p.prisma as never)

describe('registrarDecisaoDeclarada — três estados, nunca dois', () => {
  it('declaração vira evento, com o texto ORIGINAL e o canal de quem chamou', async () => {
    const p = fakePrisma()
    const r = await svcCom(p).registrarDecisaoDeclarada({
      texto:     'decidimos usar Postgres em vez de Mongo',
      sessionId: 'web-1',
      projectId: 'proj-1',
      canal:     'chat',
    })

    expect(r).toBe('registrado')
    expect(p.eventos[0]).toMatchObject({
      type:      'decision',
      source:    'chat',
      projectId: 'proj-1',
      content:   'decidimos usar Postgres em vez de Mongo',
    })
  })

  it('texto que não se apresenta como decisão não grava nada', async () => {
    const p = fakePrisma()
    expect(await svcCom(p).registrarDecisaoDeclarada({
      texto: 'como está o deploy?', sessionId: 'web-1', canal: 'chat',
    })).toBe('nao-e-decisao')
    expect(p.eventos).toHaveLength(0)
  })

  /** Reuso de `pareceDecisao`: "ainda não decidimos" é o oposto de decisão — conserto de 18/08. */
  it('negação antes do verbo não vira decisão', async () => {
    const p = fakePrisma()
    expect(await svcCom(p).registrarDecisaoDeclarada({
      texto: 'ainda não decidimos isso', sessionId: 'web-1', canal: 'chat',
    })).toBe('nao-e-decisao')
  })

  /**
   * ── A asserção que justifica os três estados ─────────────────────────────
   *
   * Com um booleano, "não havia o que gravar" e "havia e o banco recusou" respondem a mesma
   * coisa. É a lição de 16/09 em `fontes-de-contexto.ts`: colapsar `falhou` em `vazio` é o que
   * faz defeito parecer ausência.
   */
  it('falha do banco é `falhou`, não `nao-e-decisao`', async () => {
    const p = fakePrisma({ falhaAoCriar: true })
    expect(await svcCom(p).registrarDecisaoDeclarada({
      texto: 'decidimos usar Postgres', sessionId: 'web-1', canal: 'chat',
    })).toBe('falhou')
  })

  /** Nunca lança: quem chama está no meio de responder a uma pessoa. */
  it('não propaga a exceção do banco', async () => {
    const p = fakePrisma({ falhaAoCriar: true })
    await expect(svcCom(p).registrarDecisaoDeclarada({
      texto: 'decidimos usar Postgres', sessionId: 'web-1', canal: 'chat',
    })).resolves.toBe('falhou')
  })

  /** Sem projeto, o registro mora no Geral — decisão de 18/09. Órfão é defeito, não escopo. */
  it('sem projectId o evento nasce no Geral, nunca órfão', async () => {
    const p = fakePrisma()
    await svcCom(p).registrarDecisaoDeclarada({
      texto: 'decidimos adiar o restore', sessionId: 'web-1', canal: 'chat',
    })
    expect(p.eventos[0].projectId).toBe(PROJETO_GERAL_ID)
  })
})

/**
 * ── O ponto único por onde passam web e Telegram ────────────────────────────
 *
 * O Telegram fala com a própria api por `POST /orchestrate` — de propósito, para não fechar o
 * ciclo de módulo que derrubou a produção em 14/09. Então as duas rotas deste controller são os
 * três canais. Pôr a regra nos dez `createMany` do orquestrador seria espalhá-la de novo.
 */
describe('OrchestratorController registra a decisão nas DUAS rotas', () => {
  const svcFake = () => ({
    handleMessage:            async () => ({ reply: 'ok', tokensUsed: 1 }),
    isPendingDocConfirmation: async () => false,
    isPendingActionResponse:  async () => false,
    classify:                 async () => ({ module: 'chat', action: null }),
    streamChat:               async () => undefined,
  })

  /** Captura o SSE cru para poder afirmar o que o cliente REALMENTE recebe. */
  const replyFake = () => {
    const escrito: string[] = []
    const raw = {
      setHeader:    () => undefined,
      flushHeaders: () => undefined,
      write:        (s: string) => { escrito.push(s) },
      end:          () => undefined,
    }
    return { reply: { hijack: () => undefined, raw } as never, escrito }
  }

  /** O payload do `event: done`, como o navegador o lê. */
  const doneDe = (escrito: string[]): Record<string, unknown> => {
    const bloco = escrito.find((s) => s.startsWith('event: done'))
    if (!bloco) throw new Error('nenhum evento `done` foi enviado')
    return JSON.parse(bloco.split('data: ')[1].trim()) as Record<string, unknown>
  }

  const sessionsFake = (resposta: 'registrado' | 'nao-e-decisao' | 'falhou' = 'registrado') => {
    const chamadas: Array<Record<string, unknown>> = []
    return {
      espiao: chamadas,
      servico: {
        registrarDecisaoDeclarada: async (e: Record<string, unknown>) => {
          chamadas.push(e)
          return resposta
        },
      },
    }
  }

  it('POST /orchestrate registra', async () => {
    const s = sessionsFake()
    const ctrl = new OrchestratorController(svcFake() as never, s.servico as never)
    const r = await ctrl.handle({ prompt: 'decidimos usar Fastify', sessionId: 'web-1', projectId: 'p1' } as never)

    expect(s.espiao).toHaveLength(1)
    expect(s.espiao[0]).toMatchObject({ texto: 'decidimos usar Fastify', sessionId: 'web-1', projectId: 'p1', canal: 'chat' })
    expect(r).toMatchObject({ reply: 'ok', decisao: 'registrado' })
  })

  it('POST /orchestrate/stream registra — é a rota que a web usa de verdade', async () => {
    const s = sessionsFake()
    const f = replyFake()
    const ctrl = new OrchestratorController(svcFake() as never, s.servico as never)
    await ctrl.stream({ prompt: 'decidimos usar Fastify', sessionId: 'web-1' } as never, f.reply)

    expect(s.espiao).toHaveLength(1)
    expect(s.espiao[0]).toMatchObject({ texto: 'decidimos usar Fastify', canal: 'chat' })
  })

  /**
   * ── O cliente precisa SABER, não supor ──────────────────────────────────
   *
   * O objetivo do projeto é "o que decide fica registrado". Uma interface que anuncia isso sem
   * perguntar ao servidor estaria afirmando o que não mediu — mesma correção do `avisou` do
   * panorama, que saía da intenção de avisar.
   */
  it('o `done` carrega o resultado do registro', async () => {
    const s = sessionsFake()
    const f = replyFake()
    const ctrl = new OrchestratorController(svcFake() as never, s.servico as never)
    await ctrl.stream({ prompt: 'decidimos usar Fastify' } as never, f.reply)

    expect(doneDe(f.escrito)).toMatchObject({ decisao: 'registrado' })
  })

  it('`falhou` chega ao cliente como falha, nunca como "não era decisão"', async () => {
    const s = sessionsFake('falhou')
    const f = replyFake()
    const ctrl = new OrchestratorController(svcFake() as never, s.servico as never)
    await ctrl.stream({ prompt: 'decidimos usar Fastify' } as never, f.reply)

    expect(doneDe(f.escrito)).toMatchObject({ decisao: 'falhou' })
  })

  /**
   * Havia QUATRO `send('done')`, um por ramo de classificação. Um ramo esquecido não daria erro:
   * diria ao cliente que nada foi registrado. Este caso exercita o ramo não-streaming, que é
   * outro `done` que não o do chat geral.
   */
  it('o ramo não-streaming também carrega o registro', async () => {
    const s = sessionsFake()
    const f = replyFake()
    const svc = { ...svcFake(), classify: async () => ({ module: 'brain', action: null }) }
    const ctrl = new OrchestratorController(svc as never, s.servico as never)
    await ctrl.stream({ prompt: 'decidimos usar Fastify' } as never, f.reply)

    expect(doneDe(f.escrito)).toMatchObject({ decisao: 'registrado' })
  })

  /**
   * A assimetria deliberada, agora estrutural: o controller só tem acesso ao que a PESSOA
   * mandou. Registrar a fala do modelo deixaria a timeline ser escrita por quem não decide.
   */
  it('o que é registrado é o prompt da pessoa, nunca a resposta do modelo', async () => {
    const s = sessionsFake()
    const svc = { ...svcFake(), handleMessage: async () => ({ reply: 'decidimos usar Mongo', tokensUsed: 1 }) }
    const ctrl = new OrchestratorController(svc as never, s.servico as never)
    await ctrl.handle({ prompt: 'o que você acha?' } as never)

    expect(s.espiao[0].texto).toBe('o que você acha?')
  })

  /** Registro é paralelo à resposta, nunca condição dela. */
  it('exceção ao registrar não derruba a resposta — e vira `falhou`, não silêncio', async () => {
    const servico = { registrarDecisaoDeclarada: async () => { throw new Error('banco fora') } }
    const ctrl = new OrchestratorController(svcFake() as never, servico as never)
    await expect(ctrl.handle({ prompt: 'decidimos usar Fastify' } as never))
      .resolves.toMatchObject({ reply: 'ok', decisao: 'falhou' })
  })
})
