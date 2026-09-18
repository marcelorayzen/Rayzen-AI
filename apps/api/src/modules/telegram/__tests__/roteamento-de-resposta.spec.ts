import { TelegramService } from '../telegram.service'

/**
 * ── A06 da auditoria de 13/09 ─────────────────────────────────────────────────
 *
 * `processUpdate` começava assim:
 *
 *     if (this.replyHandler) { this.replyHandler(text); return }
 *
 * Um campo ÚNICO, consultado antes de qualquer roteamento. Enquanto armado, toda mensagem de
 * todo chat autorizado era desviada — e quem perguntasse por último apagava a pergunta anterior.
 *
 * Era latente enquanto a sessão supervisionada não chegava ao executor (A03). Com A03 corrigido,
 * virou caminho vivo, e o custo de errar é assimétrico: do outro lado há um `Bash(git commit:*)`
 * liberado, e a resposta que se perde é uma aprovação de etapa.
 */
describe('TelegramService — para onde vai cada mensagem', () => {
  const CHAT = '111'

  function build(opts: {
    pendentes?: { id: string; projectId: string; pendingQuestion: string | null }[]
    respondeu?: boolean
  } = {}) {
    const enviados: { texto: string; chatId?: string; threadId?: string }[] = []
    const orquestrados: string[] = []
    const respondidos: { sessionId: string; reply: string }[] = []
    const pendentes = opts.pendentes ?? []

    const pendingReply = {
      resolver: jest.fn(async (texto: string) => {
        if (pendentes.length === 0) return { tipo: 'nenhuma' as const }
        if (pendentes.length > 1) return { tipo: 'ambigua' as const, sessoes: pendentes }
        return { tipo: 'unica' as const, sessionId: pendentes[0].id, reply: texto }
      }),
      responder: jest.fn(async (sessionId: string, reply: string) => {
        respondidos.push({ sessionId, reply })
        return opts.respondeu ?? true
      }),
      textoDeDesambiguacao: jest.fn(() => 'escolha uma sessão'),
    }

    const svc = Object.create(TelegramService.prototype) as TelegramService
    Object.assign(svc, {
      chatId: CHAT,
      token: '',
      replyHandlers: new Map<string, (t: string) => void>(),
      pendingReply,
      prisma: {},
      send: jest.fn(async (texto: string, chatId?: string, threadId?: string) => {
        enviados.push({ texto, chatId, threadId })
      }),
      chatAutorizado: jest.fn(async () => true),
      getOrCreateSession: jest.fn(async () => ({ sessionId: 's1', projectId: 'p1' })),
      handleCommand: jest.fn(async () => undefined),
      orchestrate: jest.fn(async (texto: string) => { orquestrados.push(texto); return 'resposta do orquestrador' }),
      comAvisoDeProjeto: (t: string) => t,
    })

    const processar = (texto: string, chatId = CHAT, threadId?: number) =>
      (svc as unknown as { processUpdate: (u: unknown) => Promise<void> }).processUpdate({
        message: { text: texto, chat: { id: chatId }, ...(threadId != null ? { message_thread_id: threadId } : {}) },
      })

    return { svc, processar, enviados, orquestrados, respondidos, pendingReply }
  }

  describe('sem pendência nenhuma', () => {
    it('conversa normal vai para o orquestrador', async () => {
      const { processar, orquestrados } = build()

      await processar('o que falta no projeto?')

      expect(orquestrados).toEqual(['o que falta no projeto?'])
    })
  })

  describe('com uma sessão aguardando aprovação', () => {
    const pendentes = [{ id: 'sess-aaaa1111', projectId: 'p1', pendingQuestion: 'Etapa concluída' }]

    it('a resposta vai para a sessão, não para o orquestrador', async () => {
      const { processar, respondidos, orquestrados } = build({ pendentes })

      await processar('pode continuar')

      expect(respondidos).toEqual([{ sessionId: 'sess-aaaa1111', reply: 'pode continuar' }])
      expect(orquestrados).toEqual([])
    })

    /**
     * O defeito que fazia a escolha de um projeto virar a aprovação de uma etapa de código:
     * o callback global era consultado ANTES do roteamento de comandos.
     */
    it('comando NÃO é engolido como resposta da sessão', async () => {
      const { processar, respondidos, svc } = build({ pendentes })

      await processar('/projeto')

      expect(respondidos).toEqual([])
      expect((svc as unknown as { handleCommand: jest.Mock }).handleCommand).toHaveBeenCalled()
    })

    it('se a sessão saiu de waiting entre a consulta e a escrita, a mensagem não some', async () => {
      const { processar, orquestrados } = build({ pendentes, respondeu: false })

      await processar('pode continuar')

      // Cai no fluxo normal em vez de ser engolida em silêncio.
      expect(orquestrados).toEqual(['pode continuar'])
    })
  })

  describe('com duas sessões aguardando', () => {
    const pendentes = [
      { id: 'sess-aaaa1111', projectId: 'p1', pendingQuestion: 'Etapa A' },
      { id: 'sess-bbbb2222', projectId: 'p2', pendingQuestion: 'Etapa B' },
    ]

    it('não adivinha: pede desambiguação e não responde nenhuma', async () => {
      const { processar, respondidos, enviados } = build({ pendentes })

      await processar('pode continuar')

      expect(respondidos).toEqual([])
      expect(enviados.map((e) => e.texto)).toContain('escolha uma sessão')
    })
  })

  describe('seleção pendente de /projeto ou /autorizar', () => {
    it('é consumida no chat onde foi pedida', async () => {
      const { svc, processar } = build()
      const escolhido: string[] = []
      svc.setReplyHandler((t) => escolhido.push(t), CHAT)

      await processar('2')

      expect(escolhido).toEqual(['2'])
    })

    /**
     * O sintoma mais amplo do callback global: uma seleção pendente no chat privado desviava
     * mensagem de QUALQUER outro chat ou tópico autorizado.
     */
    it('NÃO intercepta mensagem de outro chat', async () => {
      const { svc, processar, orquestrados } = build()
      const escolhido: string[] = []
      svc.setReplyHandler((t) => escolhido.push(t), CHAT)

      await processar('o que falta no projeto?', '222')

      expect(escolhido).toEqual([])
      expect(orquestrados).toEqual(['o que falta no projeto?'])
    })

    it('NÃO intercepta mensagem de outro tópico do mesmo chat', async () => {
      const { svc, processar, orquestrados } = build()
      const escolhido: string[] = []
      svc.setReplyHandler((t) => escolhido.push(t), CHAT, '7')

      await processar('o que falta no projeto?', CHAT)

      expect(escolhido).toEqual([])
      expect(orquestrados).toEqual(['o que falta no projeto?'])
    })

    it('é consumida uma única vez — a mensagem seguinte segue o fluxo normal', async () => {
      const { svc, processar, orquestrados } = build()
      const escolhido: string[] = []
      svc.setReplyHandler((t) => escolhido.push(t), CHAT)

      await processar('2')
      await processar('e agora?')

      expect(escolhido).toEqual(['2'])
      expect(orquestrados).toEqual(['e agora?'])
    })
  })
})
