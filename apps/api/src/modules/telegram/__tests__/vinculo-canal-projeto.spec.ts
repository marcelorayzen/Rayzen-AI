import { TelegramService } from '../telegram.service'

/**
 * Vínculo canal ↔ projeto.
 *
 * Até 2026-09-06 o bot atendia **um** chat, com `fromId !== TELEGRAM_CHAT_ID` na linha
 * 286. Essa comparação não era um filtro: era a **autorização** — a única coisa entre um
 * estranho e o `/orchestrate` inteiro. E o banco tinha uma única sessão, de 31/05, **sem
 * projeto**: toda mensagem de texto livre desde então foi respondida com contexto zero.
 *
 * A chave passou a ser `(chatId, threadId)` porque os quatro arranjos que interessam
 * colapsam nessa forma: conversa privada e grupo simples usam thread vazia, supergrupo
 * usa um tópico por projeto, e o grupo do WhatsApp entra depois pelo mesmo contrato.
 */
describe('TelegramService — autorização de chat', () => {
  const RAIZ = '111'

  /**
   * Em 14/09 o registro deixou de ser `upsert` e passou a ser `findUnique` + `create`: a
   * distinção entre "chat novo" e "chat já visto" é o que permite avisar o dono **uma única
   * vez** quando alguém pede acesso — antes, o silêncio era indistinguível de bot quebrado.
   * As propriedades verificadas aqui são as mesmas; só o duplo do Prisma acompanhou a mudança.
   */
  function build(chats: Record<string, { authorized: boolean; title?: string }> = {}) {
    const findUnique = jest.fn(async ({ where }: { where: { chatId: string } }) => {
      const existente = chats[where.chatId]
      return existente ? { chatId: where.chatId, title: existente.title ?? null, ...existente } : null
    })
    const create = jest.fn(async ({ data }: { data: { chatId: string; title: string | null } }) => {
      chats[data.chatId] = { authorized: false, title: data.title ?? undefined }
      return { chatId: data.chatId, authorized: false }
    })
    const update = jest.fn(async ({ where, data }: { where: { chatId: string }; data: { title?: string } }) => {
      if (chats[where.chatId] && data.title) chats[where.chatId].title = data.title
      return {}
    })
    const svc = Object.create(TelegramService.prototype) as TelegramService
    Object.assign(svc, {
      chatId: RAIZ,
      prisma: { telegramChat: { findUnique, create, update } },
      // `chatAutorizado` avisa o dono quando o chat é novo — sem este duplo, o teste quebraria
      // por falta de método, não por comportamento.
      send: jest.fn().mockResolvedValue(undefined),
    })
    const autorizado = (id: string, titulo?: string) =>
      (svc as unknown as { chatAutorizado: (c: string, t?: string) => Promise<boolean> })
        .chatAutorizado(id, titulo)
    return { autorizado, upsert: create, chats }
  }

  /**
   * A raiz não passa pelo banco de propósito: uma linha apagada por engano trancaria o
   * dono para fora do próprio bot, e não haveria de onde reabrir.
   */
  it('o chat raiz é autorizado sem consultar o banco', async () => {
    const { autorizado, upsert } = build()
    expect(await autorizado(RAIZ)).toBe(true)
    expect(upsert).not.toHaveBeenCalled()
  })

  it('chat desconhecido NÃO é atendido', async () => {
    const { autorizado } = build()
    expect(await autorizado('999')).toBe(false)
  })

  /**
   * Sem o registro, descobrir o `chatId` de um grupo novo exigiria ler log de servidor.
   * Com ele, a linha aparece em `/autorizar` e o dono libera de dentro do chat raiz.
   */
  it('chat desconhecido é REGISTRADO com o título, para poder ser autorizado depois', async () => {
    const { autorizado, upsert, chats } = build()
    await autorizado('999', 'Grupo do Commerce')
    expect(upsert).toHaveBeenCalledTimes(1)
    expect(chats['999']).toEqual({ authorized: false, title: 'Grupo do Commerce' })
  })

  it('chat já autorizado é atendido', async () => {
    const { autorizado } = build({ '999': { authorized: true } })
    expect(await autorizado('999')).toBe(true)
  })

  /**
   * O silêncio é deliberado: uma recusa educada confirmaria a existência do bot para
   * quem não deveria saber que ele está ali.
   */
  it('autorização é decidida por linha do banco, não por variável de ambiente', async () => {
    const { autorizado } = build({ '999': { authorized: false } })
    expect(await autorizado('999')).toBe(false)
    const outro = build({ '999': { authorized: true } })
    expect(await outro.autorizado('999')).toBe(true)
  })
})

describe('TelegramService — resposta no tópico certo', () => {
  function build() {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true })
    global.fetch = fetchMock as unknown as typeof fetch
    const svc = Object.create(TelegramService.prototype) as TelegramService
    Object.assign(svc, { token: 't', chatId: '111', baseUrl: 'https://x', logger: { error: jest.fn() } })
    return { svc, corpo: () => JSON.parse(fetchMock.mock.calls[0][1].body as string) }
  }

  /**
   * Sem `message_thread_id`, a resposta a uma mensagem de tópico cai no tópico Geral do
   * supergrupo — a pergunta fica num lugar e a resposta em outro.
   */
  it('com tópico, a mensagem carrega message_thread_id', async () => {
    const { svc, corpo } = build()
    await svc.send('oi', '222', '77')
    expect(corpo().message_thread_id).toBe(77)
  })

  it('sem tópico, o campo não vai — mandar 0 cairia no Geral por engano', async () => {
    const { svc, corpo } = build()
    await svc.send('oi', '222', '')
    expect(corpo()).not.toHaveProperty('message_thread_id')
  })

  /**
   * `threadId` é o TERCEIRO parâmetro e é opcional porque `agent-session.service` e
   * outros já chamam `send(texto)` e `send(texto, chatId)`.
   */
  it('as chamadas antigas de dois argumentos continuam válidas', async () => {
    const { svc, corpo } = build()
    await svc.send('oi', '222')
    expect(corpo().chat_id).toBe('222')
    expect(corpo()).not.toHaveProperty('message_thread_id')
  })
})
