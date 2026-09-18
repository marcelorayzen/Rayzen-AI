import { TelegramService } from '../telegram.service'

/**
 * ── Dois defeitos de SILÊNCIO, encontrados no primeiro uso real (14/09) ──────
 *
 * **1. Conversa livre nunca funcionou.** `orchestrate()` lê `TELEGRAM_API_TOKEN` com `?? ''` e
 * manda `Authorization: Bearer ` vazio. Essa variável **não existe** — nem no `.env`, nem no
 * compose, nem no container. Toda mensagem de texto livre batia em 401 e virava "erro ao
 * processar mensagem", enquanto os comandos (que não passam pelo orquestrador) funcionavam.
 * Uma variável que ninguém sabia que precisava existir, falhando só em runtime.
 *
 * O `JwtAuthGuard` é global e aceita **JWT ou `AGENT_TOKEN`** — o segundo já existe no ambiente
 * da API. O serviço roda DENTRO da api chamando a própria api; qual credencial ele usa nesse
 * salto é detalhe interno, e exigir uma variável própria só criou um ponto de falha a mais.
 *
 * **2. Chat não autorizado é ignorado sem dizer nada.** Grupo novo entra como
 * `authorized: false` e `processUpdate` faz `return` — nem `/projeto` responde. Do lado de fora
 * é indistinguível de bot quebrado, e foi exatamente assim que apareceu: "criei o grupo, mandei
 * /projeto e nada".
 *
 * Não responder ao desconhecido é a proteção e continua valendo. O que faltava era **avisar o
 * dono**, no chat raiz, uma única vez — quem decide é ele, e sem o aviso não há como saber que
 * existe algo a decidir.
 */
describe('TelegramService — acesso e chamada ao orquestrador', () => {
  const RAIZ = '111'

  describe('orchestrate: qual credencial usa', () => {
    function build(env: Record<string, string | undefined>) {
      const chamadas: { url: string; auth: string }[] = []
      const svc = Object.create(TelegramService.prototype) as TelegramService
      Object.assign(svc, {
        apiUrl: 'http://localhost:3001',
        config: { get: (k: string) => env[k] },
      })
      global.fetch = jest.fn(async (url: string, init: { headers: Record<string, string> }) => {
        chamadas.push({ url: String(url), auth: init.headers.Authorization })
        return { ok: true, json: async () => ({ reply: 'ok' }) }
      }) as unknown as typeof fetch

      const chamar = () =>
        (svc as unknown as { orchestrate: (p: string, s: string, pr?: string) => Promise<string> })
          .orchestrate('oi', 'sess-1')

      return { chamar, chamadas }
    }

    it('usa TELEGRAM_API_TOKEN quando ele existe', async () => {
      const { chamar, chamadas } = build({ TELEGRAM_API_TOKEN: 'jwt-proprio', AGENT_TOKEN: 'agent-tok' })

      await chamar()

      expect(chamadas[0].auth).toBe('Bearer jwt-proprio')
    })

    /** O caso real: a variável nunca existiu, e o guard já aceitava AGENT_TOKEN. */
    it('cai para AGENT_TOKEN quando TELEGRAM_API_TOKEN não existe', async () => {
      const { chamar, chamadas } = build({ AGENT_TOKEN: 'agent-tok' })

      await chamar()

      expect(chamadas[0].auth).toBe('Bearer agent-tok')
    })

    /**
     * Sem credencial nenhuma, o pedido não deve sair com `Bearer ` vazio para colher um 401
     * genérico: o erro precisa dizer o que está faltando, senão vira "erro ao processar
     * mensagem" de novo.
     */
    it('sem credencial nenhuma, falha dizendo o que falta — não manda Bearer vazio', async () => {
      const { chamar, chamadas } = build({})

      await expect(chamar()).rejects.toThrow(/AGENT_TOKEN|TELEGRAM_API_TOKEN/)
      expect(chamadas).toHaveLength(0)
    })
  })

  describe('chat desconhecido: protege, mas avisa o dono', () => {
    function build(existente: { chatId: string; authorized: boolean } | null) {
      const enviados: { texto: string; chatId?: string }[] = []
      const criados: unknown[] = []
      const svc = Object.create(TelegramService.prototype) as TelegramService
      Object.assign(svc, {
        chatId: RAIZ,
        prisma: {
          telegramChat: {
            findUnique: jest.fn().mockResolvedValue(existente),
            create: jest.fn(async (args: unknown) => { criados.push(args); return { authorized: false } }),
            update: jest.fn().mockResolvedValue({}),
          },
        },
        send: jest.fn(async (texto: string, chatId?: string) => { enviados.push({ texto, chatId }) }),
      })
      const autorizado = (id: string, titulo?: string) =>
        (svc as unknown as { chatAutorizado: (c: string, t?: string) => Promise<boolean> })
          .chatAutorizado(id, titulo)
      return { autorizado, enviados, criados }
    }

    it('o chat raiz continua autorizado sem tocar no banco', async () => {
      const { autorizado, enviados } = build(null)

      expect(await autorizado(RAIZ)).toBe(true)
      expect(enviados).toHaveLength(0)
    })

    it('grupo NOVO não é atendido, mas o dono é avisado no chat raiz', async () => {
      const { autorizado, enviados, criados } = build(null)

      expect(await autorizado('999', 'Projeto Rayzen AI')).toBe(false)
      expect(criados).toHaveLength(1)
      expect(enviados).toHaveLength(1)
      expect(enviados[0].chatId).toBe(RAIZ)
      expect(enviados[0].texto).toContain('Projeto Rayzen AI')
      expect(enviados[0].texto).toContain('/autorizar')
    })

    /** Sem isto, um chat insistente viraria fonte de spam no chat do dono. */
    it('chat já conhecido e ainda não autorizado NÃO avisa de novo', async () => {
      const { autorizado, enviados } = build({ chatId: '999', authorized: false })

      expect(await autorizado('999', 'Projeto Rayzen AI')).toBe(false)
      expect(enviados).toHaveLength(0)
    })

    it('chat já autorizado é atendido', async () => {
      const { autorizado } = build({ chatId: '999', authorized: true })

      expect(await autorizado('999')).toBe(true)
    })
  })
})
